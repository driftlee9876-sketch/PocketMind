import unittest
from wifi_host import mesh_peer
from wired import select_devices, allocated_device

class WifiHostTests(unittest.TestCase):
    def test_pc_without_vulkan_can_use_tablet(self):
        peers = ["127.0.0.1:4103"]
        devices = select_devices("RPC0: 127.0.0.1:4103 (880 MiB)",peers,allow_remote_only=True)
        self.assertEqual(devices, ["RPC0"])
        self.assertEqual(allocated_device("RPC0[127.0.0.1:4103] model buffer size = 12.42 MiB",devices,peers),"RPC0")

    def test_remote_offer(self):
        local={"Mesh":True,"Local":"100.64.0.1","Prefix":10}
        endpoint=mesh_peer("pmgpu1|100.64.0.2|"+"a"*43,local)
        self.assertEqual((endpoint["Local"],endpoint["IP"],endpoint["Port"]),("100.64.0.1","100.64.0.2",47832))
        for addr in ["127.0.0.1","8.8.8.8","not-an-ip"]:
            with self.assertRaises(ValueError):
                mesh_peer("pmgpu1|"+addr+"|"+"a"*43,local)
