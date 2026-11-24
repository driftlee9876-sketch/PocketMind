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

# The host needs slots for 20 remote devices plus its own Vulkan and CPU backends.
for file, before, after in [
    ("src/llama.cpp", "size_t llama_max_devices(void) {\n    return 16;", "size_t llama_max_devices(void) {\n    return 32;"),
    ("ggml/include/ggml-rpc.h", "GGML_RPC_MAX_SERVERS       16", "GGML_RPC_MAX_SERVERS       20"),
    ("ggml/src/ggml-backend.cpp", "#define GGML_SCHED_MAX_BACKENDS 16", "#define GGML_SCHED_MAX_BACKENDS 32"),
]:
    path = pathlib.Path(sys.argv[1]) / file
    content = path.read_text()
    if content.count(before) != 1:
        raise SystemExit("Unexpected device limit in " + file)
    path.write_text(content.replace(before, after))
