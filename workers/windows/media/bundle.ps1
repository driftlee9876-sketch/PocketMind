$ErrorActionPreference = 'Stop'
$runtime = "dist/media"
New-Item -ItemType Directory -Force $runtime | Out-Null
Copy-Item (Get-Command node.exe).Source "$runtime/node.exe"
$nodeVersion = node --version
Invoke-WebRequest "https://raw.githubusercontent.com/nodejs/node/$nodeVersion/LICENSE" -OutFile "$runtime/NODE-LICENSE.txt"
Copy-Item src/media/catalog.json, workers/windows/media/render.cjs $runtime
npm install --prefix $runtime --omit=dev --ignore-scripts --no-audit --no-fund onnxruntime-node@1.24.3 fast-png@6.2.0
if ($LASTEXITCODE) {throw "Could not install image runtime"}
$bin = "$runtime/node_modules/onnxruntime-node/bin/napi-v6"
Get-ChildItem $bin -Directory | Where-Object Name -ne 'win32' | Remove-Item -Recurse -Force
Get-ChildItem "$bin/win32" -Directory | Where-Object Name -ne 'x64' | Remove-Item -Recurse -Force
# Transpile the same inference code used by the mobile clients.
npm install --prefix "$env:RUNNER_TEMP/pm-compiler" --ignore-scripts typescript@6.0.3
if ($LASTEXITCODE) {throw "Could not install compiler"}
node -e "const fs=require('fs'),ts=require(process.env.RUNNER_TEMP+'/pm-compiler/node_modules/typescript');fs.writeFileSync('dist/media/diffusion.cjs',ts.transpileModule(fs.readFileSync('src/media/diffusion.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)"
if ($LASTEXITCODE) {throw "Image pipeline bundling failed"}
$archive="$env:RUNNER_TEMP/pm-whisper.zip"
Invoke-WebRequest https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip -OutFile $archive
if ((Get-FileHash $archive).Hash -ne "D824B1E37599F882B396E73F1EE0BFD5D0529F700314C48311DCBD00B803321D") { throw "Whisper archive hash mismatch" }
Expand-Archive $archive "$env:RUNNER_TEMP/whisper-bin"
$cli = Get-ChildItem "$env:RUNNER_TEMP/whisper-bin" -Filter whisper-cli.exe -Recurse | Select-Object -First 1
if (!$cli) {throw "Missing Whisper CLI"}
New-Item -ItemType Directory -Force "$runtime/whisper" | Out-Null
Invoke-WebRequest https://raw.githubusercontent.com/ggml-org/whisper.cpp/v1.8.3/LICENSE -OutFile "$runtime/whisper/LICENSE.txt"
Copy-Item $cli.FullName "$runtime/whisper/"
Get-ChildItem $cli.DirectoryName -Filter *.dll | Copy-Item -Destination "$runtime/whisper/"
Push-Location $runtime
try {
  .\node.exe -e "require('onnxruntime-node');require('./diffusion.cjs')"
  if ($LASTEXITCODE) {throw "Image engine startup failed"}
  & .\whisper\whisper-cli.exe --help
  if ($LASTEXITCODE) {throw "Speech engine startup failed"}
} finally {Pop-Location}
