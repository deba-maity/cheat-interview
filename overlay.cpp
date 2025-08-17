#include <napi.h>
#include <windows.h>
#include <string>
#include <thread>

#ifndef WDA_EXCLUDEFROMCAPTURE
// Windows 10 2004+ flag that hides a window from screen capture
#define WDA_EXCLUDEFROMCAPTURE 0x11
#endif

HWND hwnd = NULL;
HWND hEditInput = NULL;
HWND hStaticOutput = NULL;
Napi::ThreadSafeFunction tsfn; // Node callback

// Window procedure
LRESULT CALLBACK WindowProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_CREATE: {
            // Output (AI response)
            hStaticOutput = CreateWindowExA(
                0,
                "STATIC",
                "AI will reply here...",
                WS_CHILD | WS_VISIBLE | SS_LEFT | SS_NOPREFIX,
                10, 10, 660, 60,
                hwnd,
                (HMENU)101,
                GetModuleHandle(NULL),
                NULL
            );

            // Input (your question)
            hEditInput = CreateWindowExA(
                WS_EX_CLIENTEDGE,
                "EDIT",
                "",
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL,
                10, 80, 660, 25,
                hwnd,
                (HMENU)102,
                GetModuleHandle(NULL),
                NULL
            );

            // Give focus to input
            SetFocus(hEditInput);
            break;
        }

        case WM_KEYDOWN: {
            // Press Enter inside input → send to Node
            if (wParam == VK_RETURN && GetFocus() == hEditInput) {
                char buffer[1024];
                GetWindowTextA(hEditInput, buffer, sizeof(buffer));
                std::string question(buffer);

                // Clear after send
                SetWindowTextA(hEditInput, "");

                if (!question.empty() && tsfn) {
                    tsfn.BlockingCall([question](Napi::Env env, Napi::Function cb) {
                        cb.Call({ Napi::String::New(env, question) });
                    });
                }

                return 0; // swallow Enter "ding"
            }
            break;
        }

        case WM_DESTROY:
            PostQuitMessage(0);
            break;
    }
    return DefWindowProc(hwnd, uMsg, wParam, lParam);
}

// Show answer in static output box
Napi::Value ShowAnswer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();

    std::string answer = info[0].As<Napi::String>();
    if (hStaticOutput) {
        SetWindowTextA(hStaticOutput, answer.c_str());
    }

    return env.Undefined();
}

// Start overlay (creates window in separate thread)
Napi::Value StartOverlay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Save Node callback
    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "OverlayQuestionCallback",
        0,   // unlimited queue
        1    // one thread will use this TSFN
    );

    // Run overlay window in its own thread so Node stays responsive
    std::thread([]() {
        const char CLASS_NAME[] = "StealthOverlayWindowClass";

        WNDCLASSA wc = {};
        wc.lpfnWndProc   = WindowProc;
        wc.hInstance     = GetModuleHandle(NULL);
        wc.lpszClassName = CLASS_NAME;
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);

        RegisterClassA(&wc);

        hwnd = CreateWindowExA(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW, // overlay style
            CLASS_NAME,
            "StealthOverlay",
            WS_POPUP,
            50, 50, 700, 120,
            NULL, NULL,
            GetModuleHandle(NULL),
            NULL
        );

        if (!hwnd) return;

        // Make semi-transparent (set to 255 for opaque)
        SetLayeredWindowAttributes(hwnd, 0, 230, LWA_ALPHA);

        // Exclude from screen capture (Teams/Zoom/OBS)
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);

        MSG msg;
        while (GetMessage(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }
    }).detach();

    return env.Undefined();
}

// Module init
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("startOverlay", Napi::Function::New(env, StartOverlay));
    exports.Set("showAnswer", Napi::Function::New(env, ShowAnswer));
    return exports;
}

NODE_API_MODULE(overlay, Init)
