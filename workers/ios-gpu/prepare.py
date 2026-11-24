"""Use only caller-authenticated sockets in the iOS-specific, pinned ggml build."""
import pathlib
import hashlib
import sys

upstream = pathlib.Path(sys.argv[1])
folder = upstream / "ggml/src/ggml-rpc"
def checked(name, expected):
    file = folder / name
    data = file.read_bytes()
    if hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() != expected:
        raise RuntimeError(f"Unexpected revision of {name}")
    return file, data.decode()

header, original = checked("transport.h", "59b8845c00fcfed5b4af82285d080354ebc92ddc")
header.write_text(original.replace("    ~socket_t();", "    ~socket_t();\n    static socket_ptr adopt_paired(int fd);"))
source, original = checked("transport.cpp", "c7d9f532117c68a8994e7f7d5d5d733993db139c")
a = original.index("socket_ptr socket_t::accept()")
b = original.index("#ifdef _WIN32\nstatic std::mutex g_rpc_transport_mu;", a)
source.write_text(original[:a] + """
socket_ptr socket_t::adopt_paired(int fd) { return socket_ptr(new socket_t(std::make_unique<impl>(fd))); }
socket_ptr socket_t::accept() { return nullptr; }
socket_ptr socket_t::create_server(const char *, int) { return nullptr; }
socket_ptr socket_t::connect(const char *, int) { return nullptr; }
""" + original[b:])
source, original = checked("ggml-rpc.cpp", "dbd7dd4677092a8b68f9f24fa60168393d950e37")
# The portable function is defined in this translation unit. Link Metal in the final framework.
inc = pathlib.Path(__file__).with_name("backend.inc").read_text()
source.write_text('#include "ggml-metal.h"\n' + original + '\n' + inc)

client = pathlib.Path(__file__).with_name("client.inc").read_text()
path = folder / "transport.cpp"
path.write_text(path.read_text().replace("socket_ptr socket_t::connect(const char *, int) { return nullptr; }", client))
# On a phone the host shares a process with the UI. Signal transport loss to
# the active load/decode and drain queued messages while the session unwinds.
s = source.read_text()
s = s.replace("void rpc_dispatcher::work() {", 'extern "C" void pm_host_rpc_failed();\nvoid rpc_dispatcher::work() {\n    bool failed = false;')
s = s.replace("bool status = send_rpc_cmd", "bool status = !failed && send_rpc_cmd")
s = s.replace("RPC_STATUS_ASSERT(status);", """if (!status) {
                    failed = true;
                    pm_host_rpc_failed();
                    if (msg_ptr->output) {
                        memset(msg_ptr->output, 0, msg_ptr->output_size);
                        if (msg_ptr->cmd == RPC_CMD_GET_ALIGNMENT)
                            static_cast<rpc_msg_get_alignment_rsp *>(msg_ptr->output)->alignment = 64;
                    }
                }""")
source.write_text(s)
for file, before, after in [
    ("src/llama.cpp", "size_t llama_max_devices(void) {\n    return 16;", "size_t llama_max_devices(void) {\n    return 32;"),
    ("ggml/include/ggml-rpc.h", "GGML_RPC_MAX_SERVERS       16", "GGML_RPC_MAX_SERVERS       20"),
    ("ggml/src/ggml-backend.cpp", "#define GGML_SCHED_MAX_BACKENDS 16", "#define GGML_SCHED_MAX_BACKENDS 32"),
]:
    path = upstream / file
    s = path.read_text()
    if s.count(before) != 1:
        raise RuntimeError("Unexpected device limit in " + file)
    path.write_text(s.replace(before, after))

# Verify the real per-device model buffers before the app reports a session.
model_source = upstream / "src/llama-model.cpp"
with model_source.open("a") as f:
    f.write("""
extern "C" bool pm_model_has_weights(const llama_model *model, ggml_backend_dev_t device) {
    auto sizes = model->memory_breakdown();
    auto it = sizes.find(ggml_backend_dev_buffer_type(device));
    return it != sizes.end() && it->second > 0;
}
""")
