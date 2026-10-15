//! BK-NOTE 데스크톱(윈도우) 껍데기: 스티커 창, 오른쪽 도킹, 트레이, 전역 단축키, 빠른 입력 창, 로컬 백업.
//! 화면·데이터는 apps/web 과 같은 코드를 쓴다.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const PANEL_WIDTH: f64 = 380.0;

/// 가장 오른쪽 모니터의 작업 영역(작업표시줄 제외) 오른쪽 끝에 세로로 꽉 차게 붙인다.
#[tauri::command]
fn dock_right(window: WebviewWindow) -> Result<(), String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .max_by_key(|m| m.position().x + m.size().width as i32)
        .ok_or("모니터를 찾을 수 없음")?;
    let area = monitor.work_area();
    let width = (PANEL_WIDTH * monitor.scale_factor()).round() as u32;
    window
        .set_size(PhysicalSize::new(width, area.size.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(
            area.position.x + area.size.width as i32 - width as i32,
            area.position.y,
        ))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 매일 밤 로컬 백업: 문서 폴더/BK-NOTE 백업/ 에 저장하고 경로를 돌려준다(최근 14개만 유지).
#[tauri::command]
fn save_backup(app: AppHandle, file_name: String, contents: String) -> Result<String, String> {
    if file_name.contains(['/', '\\']) || file_name.contains("..") {
        return Err("잘못된 파일 이름".into());
    }
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("BK-NOTE 백업");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&file_name);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;

    // 같은 확장자 백업은 최근 14개만 남긴다
    if let Some(ext) = path.extension().and_then(|e| e.to_str()).map(str::to_owned) {
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some(ext.as_str()))
            .collect();
        files.sort();
        if files.len() > 14 {
            for old in &files[..files.len() - 14] {
                let _ = std::fs::remove_file(old);
            }
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

/// 빠른 입력 창 보이기(Ctrl+Alt+Space)
#[tauri::command]
fn show_quick(app: AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let _ = w.center();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn toggle_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
    let quick = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);

    tauri::Builder::default()
        // 두 번 실행하면 새로 띄우지 않고 기존 창을 앞으로
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quick"])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &toggle {
                        toggle_main(app);
                    } else if shortcut == &quick {
                        show_quick(app.clone());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            dock_right,
            save_backup,
            show_quick
        ])
        .setup(move |app| {
            // 전역 단축키(다른 프로그램이 이미 쓰면 실패할 수 있음 → 무시하고 계속)
            let gs = app.global_shortcut();
            let _ = gs.register(toggle);
            let _ = gs.register(quick);

            // 빠른 입력 창: 처음엔 숨김, 단축키로 화면 가운데에 뜬다
            WebviewWindowBuilder::new(app, "quick", WebviewUrl::App("index.html?quick=1".into()))
                .title("BK-NOTE 빠른 입력")
                .inner_size(560.0, 76.0)
                .resizable(false)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .visible(false)
                .center()
                .build()?;

            // 트레이 아이콘
            let show_i = MenuItem::with_id(app, "show", "보이기", true, None::<&str>)?;
            let quick_i = MenuItem::with_id(
                app,
                "quick",
                "빠른 입력 (Ctrl+Alt+Space)",
                true,
                None::<&str>,
            )?;
            let dock_i = MenuItem::with_id(app, "dock", "오른쪽에 붙이기", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quick_i, &dock_i, &quit_i])?;
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("BK-NOTE")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "show" => show_main(app),
                    "quick" => show_quick(app.clone()),
                    "dock" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = dock_right(w);
                            show_main(app);
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = e
                    {
                        toggle_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // 닫기(X)는 종료가 아니라 트레이로 숨기기. 종료는 트레이 메뉴에서.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("BK-NOTE 실행 실패");
}
