#!/usr/bin/env python3
"""Test the built Web image on an internal Docker network with a fake HTTPS API."""
import base64
import contextlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import uuid

IMAGE = sys.argv[1] if len(sys.argv) > 1 else 'aegis-web:151'
PREFIX = 'aegis-web-check-' + uuid.uuid4().hex[:10]
MOCK_IMAGE = 'node:24.15.0-alpine'


def docker(*args):
    result = subprocess.run(['docker', *args], check=True, capture_output=True,
                            text=True, timeout=120)
    return (result.stdout + (result.stderr if args[0] == 'logs' else '')).strip()


def request(host, path, method='GET', body=None, headers=None):
    probe = """
const http=require('node:http');
const [host,path,method,body,headers]=process.argv.slice(1);
const req=http.request({hostname:host,port:8080,path,method,headers:JSON.parse(headers)},res=>{
 const parts=[];res.on('data',x=>parts.push(x));
 res.on('end',()=>console.log(JSON.stringify([res.statusCode,res.headers,Buffer.concat(parts).toString('base64')])));
});
req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>{req.destroy();});
req.end(body);
"""
    code, headers, payload = json.loads(docker('exec', PREFIX+'-client', 'node', '-e', probe,
                                               host, path, method, body or '', json.dumps(headers or {})))
    # Normalize Node's lowercase headers for the shared assertions below.
    headers = {key.title(): value for key, value in headers.items()}
    return code, headers, base64.b64decode(payload)


@contextlib.contextmanager
def web(folder, upstream, suffix, trust=True):
    name = PREFIX + suffix
    args = ['run', '-d', '--name', name, '--network', PREFIX,
            '-e', 'AEGIS_API_HOST='+upstream]
    if trust:
        args += ['-e', 'SSL_CERT_FILE=/test/ca.pem',
                 '-v', str(folder/'cert.pem')+':/test/ca.pem:ro']
    try:
        docker(*args, IMAGE)
        port = name
        for _ in range(100):
            try:
                if request(port, '/healthz')[0] == 200:
                    break
            except (OSError, subprocess.CalledProcessError):
                pass
            time.sleep(.1)
        else:
            raise RuntimeError('Web startup failed: '+docker('logs', name))
        yield name, port
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True, timeout=30)


def main():
    docker('image', 'inspect', IMAGE)
    docker('pull', MOCK_IMAGE)
    with tempfile.TemporaryDirectory(prefix=PREFIX) as temporary:
        folder = Path(temporary)
        folder.chmod(0o755)
        (folder/'openssl.cnf').write_text(
            '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n'
            '[dn]\nCN=api-mock\n[ext]\nsubjectAltName=DNS:api-mock\n'
            'basicConstraints=critical,CA:TRUE\n')
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                        '-days', '1', '-config', str(folder/'openssl.cnf'),
                        '-keyout', str(folder/'key.pem'), '-out', str(folder/'cert.pem')],
                       check=True, capture_output=True, timeout=30)
        (folder/'mock.cjs').write_text('''
const https = require('node:https');
const fs = require('node:fs');
https.createServer({key:fs.readFileSync('/test/key.pem'),cert:fs.readFileSync('/test/cert.pem')},
(req,res)=>{
  let body=''; req.on('data', chunk=>body+=chunk);
  req.on('end',()=>{
    const code=req.method==='POST'?201:req.url.endsWith('/me')?401:429;
    res.writeHead(code,{'Content-Type':'application/problem+json','Retry-After':'60'});
    res.end(JSON.stringify({path:req.url,method:req.method,body,
      authorization:req.headers.authorization, idempotency:req.headers['idempotency-key']}));
  });
}).listen(8443,'0.0.0.0');
''')
        # This disposable test key is never a project credential.
        for file in folder.iterdir():
            file.chmod(0o644)
        try:
            docker('network', 'create', '--internal', PREFIX)
            docker('run', '-d', '--name', PREFIX+'-client', '--network', PREFIX,
                   MOCK_IMAGE, 'node', '-e', 'setInterval(()=>{},1000)')
            docker('run', '-d', '--name', PREFIX+'-api', '--network', PREFIX,
                   '--network-alias', 'api-mock', '--network-alias', 'wrong-name',
                   '--user', '1000:1000', '-v', str(folder)+':/test:ro',
                   MOCK_IMAGE, 'node', '/test/mock.cjs')
            with web(folder, 'api-mock:8443', '-web') as (name, port):
                assert docker('exec', name, 'id', '-u') == '10001'
                docker('exec', name, 'sh', '-c', 'test ! -d /app/node_modules && ! command -v node')
                print('PASS production image runs as UID 10001 without Node/node_modules', flush=True)
                code, headers, html = request(port, '/')
                assert code == 200 and b'<html' in html
                for path in ['/connexion', '/equipements/example']:
                    assert request(port, path)[2] == html
                assert headers['Cache-Control'] == 'no-cache'
                asset = re.search(rb'src="(/assets/[^\"]+\.js)"', html).group(1).decode()
                code, headers, bundle = request(port, asset)
                assert code == 200 and 'javascript' in headers['Content-Type']
                assert b'aegis-preview-only' not in bundle
                assert request(port, '/assets/missing.js')[0] == 404
                print('PASS built SPA, deep links, asset MIME, preview exclusion and missing asset', flush=True)
                code, headers, body = request(port, '/api/v1/auth/me')
                assert code == 401 and headers['Cache-Control'] == 'no-store'
                assert json.loads(body)['path'] == '/api/v1/auth/me'
                code, headers, _ = request(port, '/api/v1/limited')
                assert code == 429 and headers['Retry-After'] == '60'
                code, _, body = request(port, '/api/v1/example?a=1', 'POST', '{}',
                    {'Authorization':'Bearer test-only','Idempotency-Key':'test-only'})
                assert code == 201 and json.loads(body) == {
                    'path':'/api/v1/example?a=1','method':'POST','body':'{}',
                    'authorization':'Bearer test-only','idempotency':'test-only'}
                print('PASS HTTPS forwarding, authorization, idempotency, 401 and 429', flush=True)
                docker('stop', PREFIX+'-api')
                assert request(port, '/api/v1/auth/me')[0] == 502
                assert request(port, '/healthz')[0] == 200
                print('PASS upstream outage gives 502 while Web health remains available', flush=True)
            docker('start', PREFIX+'-api')
            with web(folder, 'wrong-name:8443', '-bad-host') as (name, port):
                assert request(port, '/api/v1/auth/me')[0] == 502
                assert 'certificate is valid for' in docker('logs', name)
                print('PASS TLS hostname mismatch rejected', flush=True)
            with web(folder, 'api-mock:8443', '-bad-ca', trust=False) as (name, port):
                assert request(port, '/api/v1/auth/me')[0] == 502
                assert 'certificate signed by unknown authority' in docker('logs', name)
                print('PASS untrusted TLS certificate rejected', flush=True)
            print('PASS Docker hosting checks complete on isolated internal network', flush=True)
        finally:
            subprocess.run(['docker', 'rm', '-f', PREFIX+'-api', PREFIX+'-client'], capture_output=True, timeout=30)
            subprocess.run(['docker', 'network', 'rm', PREFIX], capture_output=True, timeout=30)

if __name__ == '__main__':
    main()
