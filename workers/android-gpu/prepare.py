"""Install the Android-only socket adapter in a disposable, pinned upstream checkout."""
import hashlib
import pathlib
import sys

target = pathlib.Path(sys.argv[1]) / "ggml/src/ggml-rpc/transport.cpp"
original = target.read_bytes()
blob_hash = hashlib.sha1(b"blob " + str(len(original)).encode() + b"\0" + original).hexdigest()
if blob_hash != "c7d9f532117c68a8994e7f7d5d5d733993db139c":
    raise SystemExit("Unexpected ggml transport revision")
source = original.decode()
start = source.index("socket_ptr socket_t::accept()")
end = source.index("#ifdef _WIN32\nstatic std::mutex g_rpc_transport_mu;", start)
adapter = pathlib.Path(__file__).with_name("usb-socket.inc").read_text()
target.write_text(source[:start] + adapter + "\n" + source[end:])
