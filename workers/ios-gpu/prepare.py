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
