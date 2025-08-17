// overlay.cpp
#include <napi.h>
#include <windows.h>
#include <string>
#include <thread>
#include <cstdio>

#ifndef WDA_EXCLUDEFROMCAPTURE
// Windows 10 2004+ flag that hides a window from screen capture
#define WDA_EXCLUDEFROMCAPTURE 0x11
#endif

HWND hwnd = NULL;
HWND hEditInput = NULL;
HWND hStaticOutput = NULL;
Napi::ThreadSafeFunction tsfn; // Node callback

// We'll subclass the edit control so we can catch VK_RETURN
WNDPROC oldEditProc = nullptr;

// Forward declaration
LRESULT CALLBACK EditProc(HWND hwndEdit, UINT msg, WPARAM wParam, LPARAM lParam);

// Window procedure
LRESULT CALLBACK WindowProc(HWND hwndMain, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_CREATE: {
            // Output (AI response)
            hStaticOutput = CreateWindowExA(
                0,
                "STATIC",
                "AI will reply here...",
                WS_CHILD | WS_VISIBLE | SS_LEFT | SS_NOPREFIX,
                10, 10, 660, 60,
                hwndMain,
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
                hwndMain,
                (HMENU)102,
                GetModuleHandle(NULL),
                NULL
            );

            // Subclass the edit control so we receive its keystrokes
            oldEditProc = (WNDPROC)SetWindowLongPtrA(hEditInput, GWLP_WNDPROC, (LONG_PTR)EditProc);

            // Give focus to input
            SetFocus(hEditInput);
            break;
        }

        case WM_DESTROY:
            // Optional: restore original edit proc before exit
            if (oldEditProc && hEditInput) {
                SetWindowLongPtrA(hEditInput, GWLP_WNDPROC, (LONG_PTR)oldEditProc);
                oldEditProc = nullptr;
            }
            PostQuitMessage(0);
            break;
    }
    return DefWindowProcA(hwndMain, uMsg, wParam, lParam);
}

// Subclass procedure for the EDIT control
LRESULT CALLBACK EditProc(HWND hwndEdit, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_KEYDOWN) {
        if (wParam == VK_RETURN) {
            // Read current text
            char buffer[1024] = {0};
            GetWindowTextA(hwndEdit, buffer, (int)sizeof(buffer));
            std::string question(buffer);

            // Clear the edit control
            SetWindowTextA(hwndEdit, "");

            // Debug log to console (native)
            printf("✅ EditProc: Enter pressed. Question: %s\n", question.c_str());
            fflush(stdout);

            // Send to Node via TSFN (safe pattern)
            if (!question.empty() && tsfn) {
                printf("✅ EditProc: Sending question to Node.\n");
                fflush(stdout);

                std::string* qCopy = new std::string(question);
                napi_status status = tsfn.BlockingCall(qCopy, [](Napi::Env env, Napi::Function cb, std::string* data) {
                    // Call the JS callback with the question string
                    cb.Call({ Napi::String::New(env, *data) });
                    delete data;
                });

                if (status != napi_ok) {
                    printf("⚠️ EditProc: TSFN BlockingCall failed (status %d)\n", status);
                    fflush(stdout);
                }
            } else {
                if (question.empty()) {
                    printf("🔔 EditProc: Ignored empty question.\n");
                    fflush(stdout);
                } else {
                    printf("🔔 EditProc: TSFN not initialized.\n");
                    fflush(stdout);
                }
            }

            return 0; // swallow Enter
        }
    }

    // Call original proc for default behavior
    if (oldEditProc) {
        return CallWindowProcA(oldEditProc, hwndEdit, msg, wParam, lParam);
    }
    return DefWindowProcA(hwndEdit, msg, wParam, lParam);
}

// Show answer in static output box
Napi::Value ShowAnswer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();

    std::string answer = info[0].As<Napi::String>();
    if (hStaticOutput) {
        SetWindowTextA(hStaticOutput, answer.c_str());
        // Force redraw
        InvalidateRect(hStaticOutput, NULL, TRUE);
        UpdateWindow(hStaticOutput);
    }

    // Also log to native console for debugging
    printf("✅ ShowAnswer called: %s\n", answer.c_str());
    fflush(stdout);

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

    printf("✅ TSFN created\n");
    fflush(stdout);

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

        if (!hwnd) {
            printf("⚠️ CreateWindowExA failed\n");
            fflush(stdout);
            return;
        }

        // Make semi-transparent (set to 255 for opaque)
        SetLayeredWindowAttributes(hwnd, 0, 230, LWA_ALPHA);

        // Exclude from screen capture (Teams/Zoom/OBS)
        SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);

        ShowWindow(hwnd, SW_SHOW);
        UpdateWindow(hwnd);

        MSG msg;
        while (GetMessageA(&msg, NULL, 0, 0)) {
            TranslateMessage(&msg);
            DispatchMessageA(&msg);
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
