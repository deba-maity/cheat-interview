{
  "targets": [
    {
      "target_name": "overlay",
      "sources": [ "overlay.cpp" ],
"include_dirs": [
  "C:\\Users\\Dmaity\\stealth-assistant\\node_modules\\node-addon-api",
  "C:\\Users\\Dmaity\\AppData\\Local\\node-gyp\\Cache\\20.13.1\\include\\node"
],

      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "ExceptionHandling": 1
        }
      }
    }
  ]
}
