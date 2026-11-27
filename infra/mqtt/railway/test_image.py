"""Test the actual TLS image with synthetic identities on a networkless container."""
import base64
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid

from test_overlay import DOCKER, IMAGE as BASE_IMAGE, LOCKER, run

OTHER = '11111111-2222-4333-8444-555555555555'
ROOT = pathlib.Path(__file__).resolve().parents[3]


class ImageTests(unittest.TestCase):
    def test_tls_identity_persistence_and_permissions(self):
        suffix = uuid.uuid4().hex[:8]
        name, volume, image = 'aegis-tls-'+suffix, 'aegis-tls-data-'+suffix, 'aegis-broker-230:'+suffix
        with tempfile.TemporaryDirectory() as directory:
            p = pathlib.Path(directory)
            os.chmod(p, 0o700)
            def openssl(*args):
                run(['openssl', *args])
            openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(p/'ca.key'), '-out', str(p/'ca.crt'), '-days', '1', '-subj', '/CN=Aegis synthetic test CA')
            openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(p/'server.key'), '-out', str(p/'server.csr'), '-subj', '/CN=localhost')
            (p/'extensions').write_text('subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n')
            openssl('x509', '-req', '-in', str(p/'server.csr'), '-CA', str(p/'ca.crt'), '-CAkey', str(p/'ca.key'), '-CAcreateserial', '-out', str(p/'server.crt'), '-days', '1', '-extfile', str(p/'extensions'))
            env = ['AEGIS_MQTT_API_PASSWORD=synthetic-base-api', 'AEGIS_MQTT_HUB_PASSWORD=synthetic-hub', 'AEGIS_MQTT_HUB_ID='+LOCKER]
            for key, file in [('MQTT_CA_B64','ca.crt'),('MQTT_CERT_B64','server.crt'),('MQTT_KEY_B64','server.key')]:
                env.append(key+'='+base64.b64encode((p/file).read_bytes()).decode())
            (p/'env').write_text('\n'.join(env)+'\n'); os.chmod(p/'env',0o600)
            result = subprocess.run([DOCKER,'build','-f','infra/mqtt/railway/Dockerfile','-t',image,'.'],cwd=ROOT,capture_output=True,text=True,timeout=120)
            self.assertEqual(0,result.returncode,result.stderr[-1500:])
            run([DOCKER,'volume','create',volume])
            try:
                run([DOCKER,'run','--rm','--network','none','-v',volume+':/mosquitto/data','--entrypoint','sh',BASE_IMAGE,'-c',
                     'umask 077; mkdir /mosquitto/data/recipe-230; mosquitto_passwd -b -c /mosquitto/data/recipe-230/account.hash aegis_api_recipe_223 synthetic-recipe; printf "%s\\n" '+LOCKER+' > /mosquitto/data/recipe-230/locker-id; printf "true\\n" > /mosquitto/data/recipe-230/commands-enabled; mosquitto_passwd -b -c /mosquitto/data/device-accounts.hash '+OTHER+' synthetic-other; chown -R mosquitto:mosquitto /mosquitto/data'])
                def start():
                    run([DOCKER,'run','-d','--name',name,'--network','none','--env-file',str(p/'env'),'-v',volume+':/mosquitto/data',image])
                def pub(user,password,topic,host='localhost',port='8883',tls=True):
                    args=[DOCKER,'exec',name,'mosquitto_pub','-h',host,'-p',port,'-V','5','-u',user,'-P',password,'-q','1','-d','-t',topic,'-m','synthetic']
                    if tls: args+=['--cafile','/run/aegis-mqtt/ca.crt']
                    return run(args,check=False)
                topic='aegis/v1/lockers/'+LOCKER
                def ready():
                    for _ in range(40):
                        r=pub('aegis_api_recipe_223','synthetic-recipe',topic+'/display')
                        if 'RC:16' in r.stdout:return
                        time.sleep(.1)
                    self.fail('TLS image did not start: '+run([DOCKER,'logs',name],check=False).stderr[-2000:])
                start()
                for cycle in range(3):
                    ready()
                    self.assertIn('RC:16',pub('aegis_api','synthetic-base-api',topic+'/display').stdout)
                    self.assertIn('RC:16',pub(LOCKER,'synthetic-hub',topic+'/events').stdout)
                    self.assertIn('RC:16',pub(OTHER,'synthetic-other','aegis/v1/lockers/'+OTHER+'/events').stdout)
                    self.assertIn('RC:135',pub(OTHER,'synthetic-other',topic+'/events').stdout)
                    for leaf in ['display','commands']:
                        self.assertIn('RC:16',pub('aegis_api_recipe_223','synthetic-recipe',topic+'/'+leaf).stdout)
                        self.assertIn('RC:135',pub('aegis_api_recipe_223','synthetic-recipe','aegis/v1/lockers/other/'+leaf).stdout)
                    for user,password,bad_topic in [(LOCKER,'synthetic-hub','aegis/v1/lockers/other/events'),(LOCKER,'synthetic-hub',topic+'/commands'),('aegis_api','synthetic-base-api','aegis/v1/lockers/aegis_api/events'),('aegis_api_recipe_223','synthetic-recipe',topic+'/events')]:
                        self.assertIn('RC:135',pub(user,password,bad_topic).stdout)
                    self.assertNotEqual(0,pub(LOCKER,'incorrect',topic+'/events').returncode)
                    self.assertNotEqual(0,pub(LOCKER,'synthetic-hub',topic+'/events',host='127.0.0.1').returncode)
                    self.assertNotEqual(0,pub(LOCKER,'synthetic-hub',topic+'/events',port='1883',tls=False).returncode)
                    count=run([DOCKER,'exec',name,'sh','-c',"grep -c '^user aegis_api_recipe_223$' /run/aegis-mqtt/acl"]).stdout.strip()
                    self.assertEqual('1',count)
                    if cycle==0:run([DOCKER,'restart',name])
                    elif cycle==1:
                        run([DOCKER,'rm','-f',name]);start()
                # Demonstrate real TLS delivery to the existing device identity.
                sub=subprocess.Popen([DOCKER,'exec',name,'mosquitto_sub','-h','localhost','-p','8883','--cafile','/run/aegis-mqtt/ca.crt','-V','5','-u',LOCKER,'-P','synthetic-hub','-t',topic+'/commands','-C','1','-W','4'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                try:
                    time.sleep(.4)
                    pub('aegis_api_recipe_223','synthetic-recipe',topic+'/commands')
                    output,errors=sub.communicate(timeout=8)
                    self.assertEqual(0,sub.returncode,errors);self.assertEqual('synthetic',output.strip())
                finally:
                    if sub.poll() is None:sub.kill();sub.wait()
                info=json.loads(run([DOCKER,'inspect',name]).stdout)[0]
                self.assertEqual('none',info['HostConfig']['NetworkMode']);self.assertFalse(info['HostConfig']['PortBindings'])
                self.assertEqual('mosquitto',info['Config']['User'])
                self.assertNotEqual('0',run([DOCKER,'exec',name,'id','-u']).stdout.strip())
                self.assertIn('Uid:\t1883\t1883\t1883\t1883',run([DOCKER,'exec',name,'cat','/proc/1/status']).stdout)
                # Reapply from persisted policy in QR-only mode, without a hot reload path.
                run([DOCKER,'exec',name,'sh','-c',"printf 'false\\n' > /mosquitto/data/recipe-230/commands-enabled"])
                run([DOCKER,'restart',name]);ready()
                self.assertIn('RC:135',pub('aegis_api_recipe_223','synthetic-recipe',topic+'/commands').stdout)
                # An incorrectly grouped UUID cannot become a device identity.
                run([DOCKER,'exec',name,'sh','-c',"cp /mosquitto/data/device-accounts.hash /mosquitto/data/device-backup; printf '%s\\n' '1-1-1-1-1111111111111111111111111111:$7$synthetic' > /mosquitto/data/device-accounts.hash"])
                run([DOCKER,'restart',name]);run([DOCKER,'wait',name])
                self.assertEqual('25',run([DOCKER,'inspect','-f','{{.State.ExitCode}}',name]).stdout.strip())
                run([DOCKER,'run','--rm','--network','none','-v',volume+':/mosquitto/data','--entrypoint','sh',BASE_IMAGE,'-c','mv /mosquitto/data/device-backup /mosquitto/data/device-accounts.hash'])
                run([DOCKER,'restart',name]);ready()
                # Missing bundle must prevent the listener from starting, not fall back globally.
                run([DOCKER,'exec',name,'rm','/mosquitto/data/recipe-230/account.hash'])
                run([DOCKER,'restart',name]);run([DOCKER,'wait',name])
                state=json.loads(run([DOCKER,'inspect',name]).stdout)[0]['State']
                self.assertFalse(state['Running']);self.assertNotEqual(0,state['ExitCode'])
            finally:
                run([DOCKER,'rm','-f',name],check=False)
                run([DOCKER,'volume','rm',volume],check=False)
                run([DOCKER,'image','rm',image],check=False)


if __name__=='__main__':unittest.main()
