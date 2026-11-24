"""Expand a pinned tiny test GGUF to 40 layers for the 20-device CI run."""
import re
import sys
import gguf

reader = gguf.GGUFReader(sys.argv[1])
arch = reader.get_field("general.architecture").contents()
writer = gguf.GGUFWriter(sys.argv[2], arch)
for field in reader.fields.values():
    if field.name.startswith("GGUF.") or field.name == "general.architecture":
        continue
    kind = field.types[0]
    value = 40 if field.name == arch + ".block_count" else field.contents()
    writer.add_key_value(field.name, value, kind, sub_type=field.types[-1] if kind == gguf.GGUFValueType.ARRAY else None)
layers = reader.get_field(arch + ".block_count").contents()
for tensor in reader.tensors:
    match = re.match(r"blk\.(\d+)\.(.+)", tensor.name)
    names = [tensor.name] if not match else [f"blk.{i}.{match[2]}" for i in range(int(match[1]), 40, layers)]
    for name in names:
        writer.add_tensor(name, tensor.data, raw_dtype=tensor.tensor_type)
writer.write_header_to_file()
writer.write_kv_data_to_file()
writer.write_tensors_to_file()
writer.close()
