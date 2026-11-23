package org.pocketmind.testadvert;
import android.app.Activity;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Bundle;
import android.util.Log;

public final class Advert extends Activity {
  private NsdManager manager;
  private final NsdManager.RegistrationListener listener = new NsdManager.RegistrationListener(){
    public void onServiceRegistered(NsdServiceInfo service){ Log.i("PM-TestAdvert","registered "+service.getServiceName()); }
    public void onRegistrationFailed(NsdServiceInfo s,int code){Log.e("PM-TestAdvert","failed "+code);}
    public void onServiceUnregistered(NsdServiceInfo s){}
    public void onUnregistrationFailed(NsdServiceInfo s,int code){}
  };
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    manager=(NsdManager)getSystemService(NSD_SERVICE);
    NsdServiceInfo peer=new NsdServiceInfo();
    peer.setServiceType("_pmgpu._tcp.");
    peer.setServiceName("PocketMind QA desktop");
    peer.setPort(17653);
    peer.setAttribute("id",getIntent().getStringExtra("pin"));
    peer.setAttribute("platform","Windows");
    // Emulator alias for the test runner's loopback TLS endpoint.
    peer.setAttribute("ip","10.0.2.2");
    manager.registerService(peer,NsdManager.PROTOCOL_DNS_SD,listener);
  }
  @Override public void onDestroy() { manager.unregisterService(listener);super.onDestroy(); }
}
