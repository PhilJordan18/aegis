#!/usr/bin/env python3
"""Exercise the production Caddyfile against an isolated HTTPS API; no staging access."""
import contextlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
CADDY = os.environ.get('CADDY_BIN', 'caddy')

class Api(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        code = 401 if self.path.endswith('/me') else 429
        payload = json.dumps({'status': code}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/problem+json')
        self.send_header('Retry-After', '60')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        payload = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        body = json.dumps({'path': self.path, 'method': self.command,
                           'authorization': self.headers.get('Authorization'),
                           'idempotency': self.headers.get('Idempotency-Key'),
                           'host': self.headers.get('Host'),
                           'body': payload.decode()}).encode()
        self.send_response(201)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def request(port, path, method='GET', body=None, headers=None):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        conn.close()


@contextlib.contextmanager
def hosting(folder, upstream, certificate):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = {**os.environ, 'PORT': str(port), 'AEGIS_API_HOST': upstream,
           'AEGIS_WEB_BIND': '127.0.0.1',
           'AEGIS_WEB_ROOT': str(ROOT/'dist'), 'SSL_CERT_FILE': str(certificate)}
    with (folder/'caddy.log').open('wb') as log:
        proc = subprocess.Popen([CADDY, 'run', '--config', str(ROOT/'deploy/Caddyfile'),
                                 '--adapter', 'caddyfile'], env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if proc.poll() is not None:
                    raise RuntimeError('Caddy exited: '+(folder/'caddy.log').read_text())
                try:
                    if request(port, '/healthz')[0] == 200:
                        break
                except OSError:
                    pass
                time.sleep(.05)
            else:
                raise RuntimeError('Caddy startup timed out')
            yield port
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()


def main():
    index = (ROOT/'dist/index.html').read_bytes()
    with tempfile.TemporaryDirectory(prefix='aegis-hosting-') as temporary:
        folder = Path(temporary)
        cert, key = folder/'cert.pem', folder/'key.pem'
        config = folder/'openssl.cnf'
        config.write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n'
                          '[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\n'
                          'basicConstraints=critical,CA:TRUE\n')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '1', '-config', str(config), '-keyout', str(key),
                        '-out', str(cert)], check=True, capture_output=True)
        api = ThreadingHTTPServer(('127.0.0.1', 0), Api)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        api.socket = tls.wrap_socket(api.socket, server_side=True)
        thread = threading.Thread(target=api.serve_forever, daemon=True)
        thread.start()
        upstream = f'localhost:{api.server_port}'
        try:
            with hosting(folder, upstream, cert) as port:
                assert request(port, '/healthz')[2] == b'ok'
                print('PASS healthcheck')
                for path in ['/', '/connexion', '/equipements/example']:
                    code, headers, body = request(port, path)
                    assert code == 200 and body == index
                    assert headers['Cache-Control'] == 'no-cache'
                    assert headers['X-Content-Type-Options'] == 'nosniff'
                print('PASS SPA deep links and HTML cache policy')
                asset = next((ROOT/'dist/assets').glob('*.js'))
                code, headers, body = request(port, '/assets/'+asset.name)
                assert code == 200 and body == asset.read_bytes()
                assert 'javascript' in headers['Content-Type']
                assert request(port, '/assets/missing.js')[0] == 404
                print('PASS assets, MIME type and missing bundle 404')
                code, headers, body = request(port, '/api/v1/auth/me')
                assert code == 401 and json.loads(body)['status'] == 401
                assert headers['Cache-Control'] == 'no-store'
                assert 'problem+json' in headers['Content-Type']
                code, headers, body = request(port, '/api/v1/limited')
                assert code == 429 and headers['Retry-After'] == '60'
                print('PASS API 401 and 429 preserved')
                code, _, body = request(port, '/api/v1/example?name=a%20b', 'POST',
                    '{"example":true}', {'Authorization': 'Bearer test-only',
                    'Content-Type': 'application/json', 'Idempotency-Key': 'test-only'})
                assert code == 201
                assert json.loads(body) == {'path':'/api/v1/example?name=a%20b',
                    'method':'POST', 'authorization':'Bearer test-only',
                    'idempotency':'test-only', 'host':upstream, 'body':'{"example":true}'}
                print('PASS HTTPS upstream, method, path, query, body and headers')
            # The same trusted certificate must fail for a hostname outside its SAN.
            with hosting(folder, f'127.0.0.1:{api.server_port}', cert) as port:
                assert request(port, '/api/v1/auth/me')[0] == 502
                print('PASS upstream TLS hostname mismatch rejected')
        finally:
            api.shutdown()
            api.server_close()
            thread.join(timeout=5)
        with hosting(folder, upstream, cert) as port:
            code, _, body = request(port, '/api/v1/auth/me')
            assert code == 502 and body != index
            assert request(port, '/healthz')[0] == 200
            print('PASS upstream outage returns 502, not SPA HTML')
    print('PASS hosting checks complete; no staging request sent')

if __name__ == '__main__':
    main()
