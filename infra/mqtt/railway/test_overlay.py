"""Exercise a cold boot and restart using synthetic credentials and no network access."""
import pathlib
import subprocess
import tempfile
import shutil
import uuid
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
DOCKER = shutil.which('docker') or 'docker'
IMAGE = 'eclipse-mosquitto@sha256:38c0da4f2ef84284d47b3b3eeea1cb3bdeabe81ee10caf0cd5c5ff61ee3ea408'
LOCKER = 'd46a74ae-39dc-460b-8af0-38fc791b376a'


def run(args, check=True):
    return subprocess.run(args, check=check, capture_output=True, text=True, timeout=30)


class OverlayTests(unittest.TestCase):
    def test_rejects_extra_identity_without_trailing_newline(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)
            base, bundle = path / 'base', path / 'bundle'
            base.mkdir(); bundle.mkdir()
            (base / 'passwords').write_text('original:synthetic\n')
            (base / 'acl').write_text('user original\n')
            (bundle / 'locker-id').write_text(LOCKER+'\n')
            (bundle / 'commands-enabled').write_text('true\n')
            (bundle / 'account.hash').write_text('aegis_api_recipe_223:$7$synthetic\nextra_account:$7$synthetic')
            result = run(['sh', str(ROOT / 'install-recipe-overlay.sh'), str(base), str(bundle)], check=False)
            self.assertEqual(23, result.returncode)
            self.assertEqual('original:synthetic\n', (base / 'passwords').read_text())
            self.assertEqual('user original\n', (base / 'acl').read_text())

    def test_rejects_multiline_locker_acl_injection(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)
            base, bundle = path / 'base', path / 'bundle'
            base.mkdir(); bundle.mkdir()
            (base / 'passwords').write_text('original:synthetic\n')
            (base / 'acl').write_text('user original\n')
            (bundle / 'locker-id').write_text(LOCKER+'\ntopic readwrite #\n#')
            (bundle / 'commands-enabled').write_text('true\n')
            (bundle / 'account.hash').write_text('aegis_api_recipe_223:$7$synthetic\n')
            result = run(['sh', str(ROOT / 'install-recipe-overlay.sh'), str(base), str(bundle)], check=False)
            self.assertEqual(20, result.returncode)
            self.assertEqual('original:synthetic\n', (base / 'passwords').read_text())
            self.assertEqual('user original\n', (base / 'acl').read_text())

    def test_restarts_permissions_and_corrupt_bundle(self):
        with tempfile.TemporaryDirectory(prefix='aegis-overlay-230-') as directory:
            path = pathlib.Path(directory)
            (path / 'boot.sh').write_text('''#!/bin/sh
set -eu
mkdir -p /tmp/auth /tmp/bundle
if [ ! -f /tmp/bundle/account.hash ]; then
 mosquitto_passwd -b -c /tmp/bundle/account.hash aegis_api_recipe_223 synthetic-test-only
 printf '%s\\n' "$LOCKER" > /tmp/bundle/locker-id
 printf 'true\\n' > /tmp/bundle/commands-enabled
fi
: > /tmp/auth/passwords
printf 'pattern read aegis/v1/lockers/%%u/commands\\npattern write aegis/v1/lockers/%%u/events\\n' > /tmp/auth/acl
sh /source/install-recipe-overlay.sh /tmp/auth /tmp/bundle
chown -R mosquitto:mosquitto /tmp/auth
chmod 700 /tmp/auth
chmod 600 /tmp/auth/passwords /tmp/auth/acl
printf 'listener 1883 127.0.0.1\\nallow_anonymous false\\npassword_file /tmp/auth/passwords\\nacl_file /tmp/auth/acl\\n' > /tmp/mosquitto.conf
exec mosquitto -c /tmp/mosquitto.conf
''')
            name = 'aegis-overlay-230-test-'+uuid.uuid4().hex[:8]
            run([DOCKER, 'run', '-d', '--name', name, '--network', 'none', '-e', 'LOCKER='+LOCKER,
                 '-v', str(ROOT)+':/source:ro', '-v', str(path)+':/fixture:ro',
                 '--entrypoint', 'sh', IMAGE, '/fixture/boot.sh'])
            try:
                def publish(topic):
                    return run([DOCKER, 'exec', name, 'mosquitto_pub', '-h', '127.0.0.1', '-V', '5',
                                '-u', 'aegis_api_recipe_223', '-P', 'synthetic-test-only',
                                '-q', '1', '-d', '-t', topic, '-m', 'synthetic'], check=False)
                def ready():
                    import time
                    for _ in range(30):
                        r = publish('aegis/v1/lockers/'+LOCKER+'/display')
                        if 'RC:16' in r.stdout: return
                        time.sleep(.1)
                    self.fail('Broker failed to start: '+run([DOCKER, 'logs', name], check=False).stderr+' client='+r.stdout+r.stderr)
                for cycle in range(2):
                    ready()
                    for suffix in ('display', 'commands'):
                        self.assertIn('RC:16', publish('aegis/v1/lockers/'+LOCKER+'/'+suffix).stdout)
                    for topic in ('aegis/v1/lockers/other/commands', 'aegis/v1/lockers/other/display',
                                  'aegis/v1/lockers/'+LOCKER+'/events',
                                  'aegis/v1/lockers/aegis_api_recipe_223/events'):
                        self.assertIn('RC:135', publish(topic).stdout)
                    if cycle == 0: run([DOCKER, 'restart', name])
                run([DOCKER, 'exec', name, 'sh', '-c', "printf 'false\\n' > /tmp/bundle/commands-enabled"])
                run([DOCKER, 'restart', name]); ready()
                self.assertIn('RC:135', publish('aegis/v1/lockers/'+LOCKER+'/commands').stdout)
                # A second application cannot silently broaden or duplicate the ACL.
                r=run([DOCKER,'exec',name,'sh','/source/install-recipe-overlay.sh','/tmp/auth','/tmp/bundle'],check=False)
                self.assertEqual(22, r.returncode)
                run([DOCKER,'exec',name,'sh','-c',"printf '../wrong\\n' > /tmp/bundle/locker-id"])
                run([DOCKER,'restart',name])
                run([DOCKER,'wait',name])
                state=run([DOCKER,'inspect','-f','{{.State.ExitCode}}',name]).stdout.strip()
                self.assertEqual('20',state)
            finally:
                run([DOCKER, 'rm', '-f', name], check=False)


if __name__ == '__main__':
    unittest.main()
