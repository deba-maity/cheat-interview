#define NOMINMAX

#include <windowsx.h> // <-- this one gives you GET_X_LPARAM & GET_Y_LPARAM

#include <napi.h>
#include <windows.h>
#include <string>
#include <thread>
#include <cstdio>
#include <algorithm>  // for std::max

#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x11
#endif

HWND hwnd = NULL;
HWND hEditInput = NULL;
// NOTE: still named hStaticOutput to minimize changes elsewhere, but it's an EDIT control now.
HWND hStaticOutput = NULL;
Napi::ThreadSafeFunction tsfn;

WNDPROC oldEditProc = nullptr;
LRESULT CALLBACK EditProc(HWND hwndEdit, UINT msg, WPARAM wParam, LPARAM lParam);

// Theme colors
COLORREF bgColor = RGB(255, 255, 255);
COLORREF textColor = RGB(0, 0, 0);

// Hit-test margin (pixels) for resizing a borderless window
static const int kResizeBorder = 8;

LRESULT CALLBACK WindowProc(HWND hwndMain, UINT uMsg, WPARAM wParam, LPARAM lParam) {
    switch (uMsg) {
        case WM_CREATE: {
            // Create a multiline READONLY EDIT for output (with vertical scroll + wrap)
            // Using WS_EX_CLIENTEDGE to visually separate the area
            RECT rc; GetClientRect(hwndMain, &rc);
            int clientW = rc.right - rc.left;
            int clientH = rc.bottom - rc.top;
            int inputH = 25;
            int padding = 10;

            int outX = padding;
            int outY = padding;
            int outW = clientW - padding * 2;
            int outH = std::max(60, clientH - inputH - padding * 3); // fill remaining space

            hStaticOutput = CreateWindowExA(
                WS_EX_CLIENTEDGE,
                "EDIT",
                "AI will reply here...",
                WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_READONLY |
                ES_AUTOVSCROLL | WS_VSCROLL, // wrap by default (no ES_AUTOHSCROLL/WS_HSCROLL)
                outX, outY, outW, outH,
                hwndMain,
                (HMENU)101,
                GetModuleHandle(NULL),
                NULL
            );

            // Allow large texts (e.g., long LLM responses)
            SendMessageA(hStaticOutput, EM_SETLIMITTEXT, (WPARAM) (16 * 1024 * 1024), 0);

            // Input (single line) anchored to bottom
            int inX = padding;
            int inY = padding + outH + padding;
            int inW = clientW - padding * 2;

            hEditInput = CreateWindowExA(
                WS_EX_CLIENTEDGE,
                "EDIT",
                "",
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | ES_AUTOHSCROLL,
                inX, inY, inW, inputH,
                hwndMain,
                (HMENU)102,
                GetModuleHandle(NULL),
                NULL
            );

            // Subclass the edit control to capture Enter
            oldEditProc = (WNDPROC)SetWindowLongPtrA(hEditInput, GWLP_WNDPROC, (LONG_PTR)EditProc);

            SetFocus(hEditInput);
            break;
        }

        case WM_CTLCOLORSTATIC:
        case WM_CTLCOLOREDIT: {
            HDC hdc = (HDC)wParam;
            SetTextColor(hdc, textColor);
            SetBkColor(hdc, bgColor);
            // Recreate a brush every paint would leak; use a static one once.
            // If you toggle theme often, consider managing a global brush and recreating it on toggle.
            static HBRUSH hBrush = CreateSolidBrush(bgColor);
            return (LRESULT)hBrush;
        }

        case WM_SIZE: {
            // Re-layout children when the window changes size
            int width  = LOWORD(lParam);
            int height = HIWORD(lParam);
            int padding = 10;
            int inputH = 25;

            if (hStaticOutput && hEditInput) {
                int outX = padding;
                int outY = padding;
                int outW = std::max(100, width  - padding * 2);
                int outH = std::max(60,   height - inputH - padding * 3);

                MoveWindow(hStaticOutput, outX, outY, outW, outH, TRUE);

                int inX = padding;
                int inY = outY + outH + padding;
                int inW = outW;

                MoveWindow(hEditInput, inX, inY, inW, inputH, TRUE);
            }
            break;
        }

        // Make the borderless popup window resizable by hit-testing near edges
        case WM_NCHITTEST: {
            LRESULT hit = DefWindowProcA(hwndMain, uMsg, wParam, lParam);
            if (hit == HTCLIENT) {
                POINT pt{ GET_X_LPARAM(lParam), GET_Y_LPARAM(lParam) };
                RECT rc; GetWindowRect(hwndMain, &rc);

                const bool left   = pt.x >= rc.left && pt.x <  rc.left + kResizeBorder;
                const bool right  = pt.x <= rc.right && pt.x > rc.right - kResizeBorder;
                const bool top    = pt.y >= rc.top &&  pt.y <  rc.top + kResizeBorder;
                const bool bottom = pt.y <= rc.bottom && pt.y > rc.bottom - kResizeBorder;

                if (left && top)        return HTTOPLEFT;
                if (right && top)       return HTTOPRIGHT;
                if (left && bottom)     return HTBOTTOMLEFT;
                if (right && bottom)    return HTBOTTOMRIGHT;
                if (left)               return HTLEFT;
                if (right)              return HTRIGHT;
                if (top)                return HTTOP;
                if (bottom)             return HTBOTTOM;
            }
            return hit;
        }

        case WM_DESTROY:
            if (oldEditProc && hEditInput) {
                SetWindowLongPtrA(hEditInput, GWLP_WNDPROC, (LONG_PTR)oldEditProc);
                oldEditProc = nullptr;
            }
            PostQuitMessage(0);
            break;
    }
    return DefWindowProcA(hwndMain, uMsg, wParam, lParam);
}

LRESULT CALLBACK EditProc(HWND hwndEdit, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_KEYDOWN && wParam == VK_RETURN) {
        char buffer[4096] = {0};
        GetWindowTextA(hwndEdit, buffer, (int)sizeof(buffer));
        std::string question(buffer);
        SetWindowTextA(hwndEdit, "");

        printf("✅ EditProc: Enter pressed. Question: %s\n", question.c_str());
        fflush(stdout);

        if (!question.empty() && tsfn) {
            std::string* qCopy = new std::string(question);
            napi_status status = tsfn.BlockingCall(qCopy, [](Napi::Env env, Napi::Function cb, std::string* data) {
                cb.Call({ Napi::String::New(env, *data) });
                delete data;
            });
            if (status != napi_ok) {
                printf("⚠️ EditProc: TSFN BlockingCall failed (status %d)\n", status);
                fflush(stdout);
            }
        }
        return 0; // swallow Enter
    }
    return oldEditProc ? CallWindowProcA(oldEditProc, hwndEdit, msg, wParam, lParam)
                       : DefWindowProcA(hwndEdit, msg, wParam, lParam);
}

// Show answer in the (now multiline) output box and auto-scroll to bottom
Napi::Value ShowAnswer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) return env.Undefined();

    std::string answer = info[0].As<Napi::String>();
    std::string formatted = answer;
    size_t pos = 0;
    while ((pos = formatted.find("\n", pos)) != std::string::npos) {
        formatted.replace(pos, 1, "\r\n");
        pos += 2;
    }
    if (hStaticOutput) {
        SetWindowTextA(hStaticOutput, formatted.c_str());

        // Auto-scroll caret to the end
        int len = GetWindowTextLengthA(hStaticOutput);
        SendMessageA(hStaticOutput, EM_SETSEL, (WPARAM)len, (LPARAM)len);
        SendMessageA(hStaticOutput, EM_SCROLLCARET, 0, 0);

        InvalidateRect(hStaticOutput, NULL, TRUE);
        UpdateWindow(hStaticOutput);
    }

    printf("✅ ShowAnswer called: %s\n", answer.c_str());
    fflush(stdout);
    return env.Undefined();
}

// Move overlay window (preserve current size so user resizing is respected)
Napi::Value MoveWindowOverlay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) return env.Undefined();

    int x = info[0].As<Napi::Number>().Int32Value();
    int y = info[1].As<Napi::Number>().Int32Value();

    if (hwnd) {
        RECT rc; GetWindowRect(hwnd, &rc);
        int w = rc.right - rc.left;
        int h = rc.bottom - rc.top;
        SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_SHOWWINDOW);
        printf("✅ Overlay moved to (%d,%d) size preserved (%dx%d)\n", x, y, w, h);
    }
    return env.Undefined();
}

// Toggle theme (colors applied via WM_CTLCOLOR*)
Napi::Value ToggleTheme(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsBoolean()) return env.Undefined();

    bool dark = info[0].As<Napi::Boolean>();
    if (dark) {
        bgColor = RGB(30, 30, 30);
        textColor = RGB(255, 255, 255);
    } else {
        bgColor = RGB(255, 255, 255);
        textColor = RGB(0, 0, 0);
    }

    if (hStaticOutput) InvalidateRect(hStaticOutput, NULL, TRUE);
    if (hEditInput) InvalidateRect(hEditInput, NULL, TRUE);
    UpdateWindow(hwnd);

    printf("✅ Theme toggled: %s\n", dark ? "Dark" : "Light");
    fflush(stdout);
    return env.Undefined();
}

// Start overlay
Napi::Value StartOverlay(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsFunction()) {
        Napi::TypeError::New(env, "Callback function required").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    tsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "OverlayQuestionCallback",
        0,  // unlimited queue
        1   // single thread uses this TSFN
    );

    std::thread([]() {
        const char CLASS_NAME[] = "StealthOverlayWindowClass";

        WNDCLASSA wc = {};
        wc.lpfnWndProc   = WindowProc;
        wc.hInstance     = GetModuleHandle(NULL);
        wc.lpszClassName = CLASS_NAME;
        wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);

        RegisterClassA(&wc);

        // Keep your current initial size; the user can resize after
        hwnd = CreateWindowExA(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            CLASS_NAME,
            "StealthOverlay",
            WS_POPUP | WS_THICKFRAME, // borderless, but resizable via WM_NCHITTEST
            50, 50, 2100, 360,
            NULL, NULL,
            GetModuleHandle(NULL),
            NULL
        );

        if (!hwnd) {
            printf("⚠️ CreateWindowExA failed\n");
            fflush(stdout);
            return;
        }

        // Semi-transparent
        SetLayeredWindowAttributes(hwnd, 0, 230, LWA_ALPHA);
        // Exclude from screen capture
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

// Init
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("startOverlay", Napi::Function::New(env, StartOverlay));
    exports.Set("showAnswer", Napi::Function::New(env, ShowAnswer));
    exports.Set("moveWindow", Napi::Function::New(env, MoveWindowOverlay));
    exports.Set("toggleTheme", Napi::Function::New(env, ToggleTheme));
    return exports;
}

NODE_API_MODULE(overlay, Init)
