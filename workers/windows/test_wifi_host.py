import unittest
from wifi_host import mesh_peer

class WifiHostTests(unittest.TestCase):
    def test_remote_offer(self):
        local={"Mesh":True,"Local":"100.64.0.1","Prefix":10}
        endpoint=mesh_peer("pmgpu1|100.64.0.2|"+"a"*43,local)
        self.assertEqual((endpoint["Local"],endpoint["IP"],endpoint["Port"]),("100.64.0.1","100.64.0.2",47832))
        for addr in ["127.0.0.1","8.8.8.8","not-an-ip"]:
            with self.assertRaises(ValueError):
                mesh_peer("pmgpu1|"+addr+"|"+"a"*43,local)
