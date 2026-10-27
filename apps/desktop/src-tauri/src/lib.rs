// The Mac shell for imbox. It opens the server the person chose in a window and gives the web app
// the few native things it asks for through `src/web/lib/native.ts`: dock badge, notifications,
// menu-bar actions, links to the default browser, mailto: links. The web app itself is not bundled.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::webview::cookie::Cookie;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, AboutMetadataBuilder, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use url::{Host, Url};

/// Diagnostics go to stderr; run the app from a terminal to read them.
macro_rules! dlog {
    ($($t:tt)*) => { eprintln!("[imbox] {}", format!($($t)*)) };
}

const WINDOW: &str = "main";
/// The name the server gives its session cookie (src/api/auth.ts).
const SESSION_COOKIE: &str = "imbox_session";
/// Where the bundled server picker lives. Only this page and the saved server may be shown in the window.
// Where the bundled picker page lives: Windows serves app pages over http, the other platforms over the tauri scheme.
#[cfg(windows)]
const PICKER: &str = "http://tauri.localhost/index.html";
#[cfg(not(windows))]
const PICKER: &str = "tauri://localhost/index.html";

#[derive(Default)]
struct Shell {
    /// The saved server, as an origin with a trailing slash.
    server: Mutex<Option<Url>>,
    /// An in-app path queued by a notification or a mailto: link; the web app takes it when the window regains focus.
    pending: Mutex<Option<String>>,
}

// ---- pure helpers (unit tested below) ----

fn is_local(u: &Url) -> bool {
    match u.host() {
        Some(Host::Domain(d)) => d == "localhost" || d.ends_with(".localhost"),
        Some(Host::Ipv4(a)) => a.is_loopback(),
        Some(Host::Ipv6(a)) => a.is_loopback(),
        None => false,
    }
}

/// Turns what someone typed into the server's origin. A bare name gets https; only a server on this
/// machine may use plain http. Paths, queries and credentials are dropped.
fn normalize_server(input: &str) -> Result<Url, String> {
    let t = input.trim();
    if t.is_empty() {
        return Err("Enter your server address.".into());
    }
    let had_scheme = t.contains("://");
    let mut u = Url::parse(&if had_scheme { t.to_string() } else { format!("https://{t}") }).map_err(|_| "That does not look like a web address.".to_string())?;
    if u.host().is_none() {
        return Err("That does not look like a web address.".into());
    }
    if !had_scheme && is_local(&u) {
        let _ = u.set_scheme("http");
    }
    match u.scheme() {
        "https" => {}
        "http" if is_local(&u) => {}
        "http" => return Err("Use https:// for a server on the internet.".into()),
        _ => return Err("Use an https:// address.".into()),
    }
    u.set_path("/");
    u.set_query(None);
    u.set_fragment(None);
    let _ = u.set_username("");
    let _ = u.set_password(None);
    Ok(u)
}

/// Only a path inside the app may be queued, never an address on another site.
fn safe_app_path(p: &str) -> Option<String> {
    if p.starts_with('/') && !p.starts_with("//") && !p.contains('\\') && !p.contains('\n') && !p.contains('\r') {
        Some(p.to_string())
    } else {
        None
    }
}

/// `mailto:a@b.c?subject=Hi` becomes `/compose?mailto=<the whole link, encoded>`, the route the web app reads.
// Links reach the app through macOS open events only so far.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mailto_path(link: &str) -> Option<String> {
    if !link.to_ascii_lowercase().starts_with("mailto:") {
        return None;
    }
    let mut q = Url::parse("http://x/compose").ok()?;
    q.query_pairs_mut().append_pair("mailto", link);
    Some(format!("{}?{}", q.path(), q.query()?))
}

fn is_app_page(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

// ---- state and window helpers ----

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("server.json"))
}

fn load_server(app: &AppHandle) -> Option<Url> {
    let raw = std::fs::read_to_string(config_path(app)?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    normalize_server(v.get("url")?.as_str()?).ok()
}

fn store_server(app: &AppHandle, u: &Url) -> Result<(), String> {
    let path = config_path(app).ok_or("No place to save the setting.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::json!({ "url": u.as_str() }).to_string()).map_err(|e| e.to_string())
}

fn saved_server(app: &AppHandle) -> Option<Url> {
    app.state::<Shell>().server.lock().ok()?.clone()
}

/// True when the window is showing the saved server, so the page asking is the one the person chose.
fn on_server(app: &AppHandle, w: &WebviewWindow) -> bool {
    match (w.url().ok(), saved_server(app)) {
        (Some(cur), Some(srv)) => cur.origin() == srv.origin(),
        _ => false,
    }
}

fn on_picker(w: &WebviewWindow) -> bool {
    w.url().map(|u| is_app_page(&u)).unwrap_or(false)
}

fn allow_navigation(app: &AppHandle, url: &Url) -> bool {
    let ok = allow_navigation_inner(app, url);
    dlog!("navigate {} -> {}", url, if ok { "allow" } else { "block" });
    ok
}

fn allow_navigation_inner(app: &AppHandle, url: &Url) -> bool {
    if is_app_page(url) || matches!(url.scheme(), "about" | "blob" | "data" | "ipc" | "asset") || url.host_str() == Some("ipc.localhost") {
        return true;
    }
    if let Some(srv) = saved_server(app) {
        if url.origin() == srv.origin() {
            return true;
        }
    }
    // Anything else leaves the app: the system browser gets web links, mailto: is left to the web app.
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
    false
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn queue_path(app: &AppHandle, path: String) {
    if let Ok(mut p) = app.state::<Shell>().pending.lock() {
        *p = Some(path);
    }
    show_main(app);
    // The window may already be focused, so the web app's focus handler would not fire; nudge it.
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.eval("window.dispatchEvent(new Event('focus'))");
    }
}

fn build_window(app: &AppHandle, start: WebviewUrl) -> tauri::Result<WebviewWindow> {
    let guard = app.clone();
    let builder = WebviewWindowBuilder::new(app, WINDOW, start).title("imbox").inner_size(1280.0, 840.0).min_inner_size(900.0, 600.0);
    // Only the Mac window draws under its title bar (the web app leaves room for the traffic lights); Windows and Linux keep theirs.
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    builder
        .visible(false)
        .initialization_script(include_str!("../../ui/picker.js"))
        .initialization_script(include_str!("../../ui/window.js"))
        .on_navigation(move |url| allow_navigation(&guard, url))
        .on_page_load(|_w, payload| {
            dlog!("page {:?} {}", payload.event(), payload.url());
        })
        .build()
}

// ---- commands the picker page may call ----

#[tauri::command]
fn get_server(app: AppHandle, window: WebviewWindow) -> Option<String> {
    dlog!("get_server");
    if !on_picker(&window) {
        return None;
    }
    saved_server(&app).map(|u| u.to_string())
}

#[tauri::command]
async fn probe_server(app: AppHandle, window: WebviewWindow, url: String) -> Result<String, String> {
    if !on_picker(&window) {
        return Err("Not allowed here.".into());
    }
    let _ = app;
    dlog!("probe_server {:?}", url);
    let origin = normalize_server(&url)?;
    let endpoint = origin.join("api/version").map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let res = client.get(endpoint).send().await.map_err(|e| {
        dlog!("probe_server request failed: {e}");
        "Could not reach that server. Check the address and your connection.".to_string()
    })?;
    dlog!("probe_server status {}", res.status());
    if !res.status().is_success() {
        return Err("That address answered, but it is not an imbox server.".into());
    }
    let body: serde_json::Value = res.json().await.map_err(|_| "That address answered, but it is not an imbox server.".to_string())?;
    if !body.get("version").map(|v| v.is_string()).unwrap_or(false) {
        return Err("That address answered, but it is not an imbox server.".into());
    }
    Ok(origin.to_string())
}

#[tauri::command]
fn save_server(app: AppHandle, window: WebviewWindow, url: String) -> Result<(), String> {
    if !on_picker(&window) {
        return Err("Not allowed here.".into());
    }
    let origin = normalize_server(&url)?;
    dlog!("save_server {}", origin);
    store_server(&app, &origin)?;
    if let Ok(mut s) = app.state::<Shell>().server.lock() {
        *s = Some(origin);
    }
    // The picker goes on to its sign-in steps; the window opens the server once there is a session.
    Ok(())
}

#[derive(Serialize)]
struct SignInOutcome {
    /// "ok" (signed in, the window is opening the server) or "mfa" (a code is needed; `ticket` goes back with it).
    status: &'static str,
    ticket: Option<String>,
}

fn api_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(format!("imbox-mac/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// POSTs JSON to the saved server (never to an address the page supplies). Returns the status, the Set-Cookie
/// headers and the JSON body, read before the response is dropped.
async fn post_auth(app: &AppHandle, path: &str, body: serde_json::Value) -> Result<(reqwest::StatusCode, Vec<String>, serde_json::Value), String> {
    let origin = saved_server(app).ok_or("Choose a server first.")?;
    let res = api_client()?.post(origin.join(path).map_err(|e| e.to_string())?).json(&body).send().await.map_err(|e| {
        dlog!("auth request failed: {e}");
        "Could not reach the server. Check your connection.".to_string()
    })?;
    let status = res.status();
    let cookies = res.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|v| v.to_str().ok().map(String::from)).collect();
    let json = res.json::<serde_json::Value>().await.unwrap_or(serde_json::Value::Null);
    Ok((status, cookies, json))
}

fn server_message(status: reqwest::StatusCode, body: &serde_json::Value) -> String {
    body.get("message").and_then(|m| m.as_str()).map(String::from).unwrap_or_else(|| format!("Sign in failed ({}).", status.as_u16()))
}

/// Hands the server's session cookie to the window, so the page it opens next is already signed in.
fn install_cookies(window: &WebviewWindow, origin: &Url, headers: &[String]) -> Result<(), String> {
    let host = origin.host_str().ok_or("That server has no host name.")?.to_string();
    let mut installed = false;
    for h in headers {
        let Ok(mut c) = Cookie::parse(h.clone()) else { continue };
        // A cookie the server is clearing (the old name) has nothing to install.
        if c.max_age().map(|d| d.whole_seconds() <= 0).unwrap_or(false) {
            continue;
        }
        if c.domain().is_none() {
            c.set_domain(host.clone());
        }
        if c.path().is_none() {
            c.set_path("/");
        }
        window.set_cookie(c).map_err(|e| e.to_string())?;
        installed = true;
    }
    if installed {
        Ok(())
    } else {
        Err("The server did not start a session.".into())
    }
}

/// Is the server's session cookie still in the window's store? `cookies_for_url` finds nothing for an address
/// that is an IP, so the whole store is searched for a cookie of this name on this host.
fn has_session(window: &WebviewWindow, origin: &Url) -> bool {
    let Some(host) = origin.host_str() else { return false };
    window
        .cookies()
        .map(|all| {
            all.iter().any(|c| {
                let d = c.domain().unwrap_or("").trim_start_matches('.');
                c.name() == SESSION_COOKIE && !d.is_empty() && (host == d || host.ends_with(&format!(".{d}")))
            })
        })
        .unwrap_or(false)
}

fn open_signed_in(app: &AppHandle, window: &WebviewWindow, cookies: &[String]) -> Result<(), String> {
    let origin = saved_server(app).ok_or("Choose a server first.")?;
    install_cookies(window, &origin, cookies)?;
    window.navigate(origin).map_err(|e| e.to_string())
}

#[tauri::command]
async fn sign_in(app: AppHandle, window: WebviewWindow, email: String, password: String) -> Result<SignInOutcome, String> {
    if !on_picker(&window) {
        return Err("Not allowed here.".into());
    }
    let (status, cookies, body) = post_auth(&app, "auth/login", serde_json::json!({ "email": email.trim(), "password": password })).await?;
    dlog!("sign_in status {}", status);
    if !status.is_success() {
        return Err(server_message(status, &body));
    }
    if body.get("mfa_required").and_then(|v| v.as_bool()).unwrap_or(false) {
        let ticket = body.get("ticket").and_then(|t| t.as_str()).map(String::from);
        return Ok(SignInOutcome { status: "mfa", ticket });
    }
    open_signed_in(&app, &window, &cookies)?;
    Ok(SignInOutcome { status: "ok", ticket: None })
}

#[tauri::command]
async fn sign_in_code(app: AppHandle, window: WebviewWindow, ticket: String, code: String) -> Result<(), String> {
    if !on_picker(&window) {
        return Err("Not allowed here.".into());
    }
    let (status, cookies, body) = post_auth(&app, "auth/login/2fa", serde_json::json!({ "ticket": ticket, "code": code.trim() })).await?;
    dlog!("sign_in_code status {}", status);
    if status.is_success() {
        return open_signed_in(&app, &window, &cookies);
    }
    // "reset:" tells the page to go back to the password step.
    Err(match body.get("error").and_then(|e| e.as_str()) {
        Some("mfa_ticket_expired") => "reset:That took too long. Sign in again.".into(),
        Some("mfa_too_many_attempts") => "reset:Too many attempts. Sign in again.".into(),
        Some("invalid_code") => "That code isn't right.".into(),
        _ => server_message(status, &body),
    })
}

/// Passkeys need a page on the server's own origin, so this opens the website's sign-in page in the window.
#[tauri::command]
fn open_web_login(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !on_picker(&window) {
        return Err("Not allowed here.".into());
    }
    let origin = saved_server(&app).ok_or("Choose a server first.")?;
    window.navigate(origin.join("login").map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

// ---- commands the saved server's page may call (names and shapes match src/web/lib/native.ts) ----

#[tauri::command]
fn set_badge(app: AppHandle, window: WebviewWindow, count: i64) {
    if !on_server(&app, &window) {
        return;
    }
    let _ = window.set_badge_count(if count > 0 { Some(count) } else { None });
}

#[tauri::command]
fn notify(app: AppHandle, window: WebviewWindow, title: String, body: String, url: Option<String>) {
    if !on_server(&app, &window) {
        return;
    }
    if let Some(path) = url.as_deref().and_then(safe_app_path) {
        if let Ok(mut p) = app.state::<Shell>().pending.lock() {
            *p = Some(path);
        }
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

#[tauri::command]
fn take_pending_url(app: AppHandle, window: WebviewWindow) -> Option<String> {
    if !on_server(&app, &window) {
        return None;
    }
    app.state::<Shell>().pending.lock().ok()?.take()
}

#[tauri::command]
fn open_external(app: AppHandle, window: WebviewWindow, url: String) {
    if !on_server(&app, &window) {
        return;
    }
    if let Ok(u) = Url::parse(&url) {
        if matches!(u.scheme(), "http" | "https") {
            let _ = app.opener().open_url(u.as_str(), None::<&str>);
        }
    }
}

#[derive(Serialize)]
struct UpdateInfo {
    available: bool,
    version: Option<String>,
    notes: Option<String>,
}

// The signed updater arrives with the release pipeline; until then the app reports that nothing is available.
#[tauri::command]
fn check_update(app: AppHandle, window: WebviewWindow) -> Option<UpdateInfo> {
    if !on_server(&app, &window) {
        return None;
    }
    Some(UpdateInfo { available: false, version: None, notes: None })
}

#[tauri::command]
fn install_update(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !on_server(&app, &window) {
        return Err("Not allowed here.".into());
    }
    Err("Updates are not available in this build yet.".into())
}

// ---- menu bar ----

/// The About panel: the icon, the name, "Version 0.1.0 (c5bc835)" and the copyright. macOS lays it out; it
/// shows `version` first and `short_version` in brackets.
#[cfg(target_os = "macos")]
fn about_metadata() -> AboutMetadata<'static> {
    AboutMetadataBuilder::new()
        .name(Some("imbox"))
        .version(Some(concat!("Version ", env!("CARGO_PKG_VERSION"))))
        .short_version(Some(env!("IMBOX_COMMIT")))
        .copyright(Some("Copyright \u{a9} 2026 fr3on"))
        .build()
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        let b = MenuItemBuilder::with_id(id, label);
        match accel {
            Some(a) => b.accelerator(a).build(app),
            None => b.build(app),
        }
    };
    // Shortcuts the web app already handles itself (c, Cmd+K, Cmd+J, Cmd+B) are shown in the labels, not bound here, so a key never fires twice.
    #[cfg(target_os = "macos")]
    let imbox_menu = SubmenuBuilder::new(app, "imbox")
        .about(Some(about_metadata()))
        .item(&item("check-updates", "Check for Updates\u{2026}", None)?)
        .separator()
        .item(&item("change-server", "Change Server\u{2026}", None)?)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    #[cfg(target_os = "macos")]
    let file = SubmenuBuilder::new(app, "File").item(&item("compose", "New Message", None)?).separator().close_window().build()?;
    // No application menu outside macOS, so its entries live in File and Help.
    #[cfg(not(target_os = "macos"))]
    let file = SubmenuBuilder::new(app, "File")
        .item(&item("compose", "New Message", None)?)
        .separator()
        .item(&item("change-server", "Change Server\u{2026}", None)?)
        .separator()
        .close_window()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit").undo().redo().separator().cut().copy().paste().select_all().build()?;
    let go = SubmenuBuilder::new(app, "Go")
        .item(&item("nav:/", "Imbox", Some("CmdOrCtrl+1"))?)
        .item(&item("nav:/screener", "Screener", Some("CmdOrCtrl+2"))?)
        .item(&item("nav:/updates", "Updates", Some("CmdOrCtrl+3"))?)
        .separator()
        .item(&item("nav:/reply-later", "Reply Later", None)?)
        .item(&item("nav:/set-aside", "Set Aside", None)?)
        .item(&item("nav:/sent", "Sent", None)?)
        .item(&item("nav:/calendar", "Calendar", None)?)
        .item(&item("nav:/contacts", "Contacts", None)?)
        .separator()
        .item(&item("palette", "Search and Commands", None)?)
        .item(&item("assistant", "Ask the Assistant", None)?)
        .separator()
        .item(&item("back", "Back", Some("CmdOrCtrl+["))?)
        .item(&item("forward", "Forward", Some("CmdOrCtrl+]"))?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View").item(&item("toggle-sidebar", "Toggle Sidebar", None)?).separator().fullscreen().build()?;
    #[cfg(target_os = "macos")]
    {
        let window = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().item(&PredefinedMenuItem::bring_all_to_front(app, None)?).build()?;
        MenuBuilder::new(app).items(&[&imbox_menu, &file, &edit, &go, &view, &window]).build()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;
        let help = SubmenuBuilder::new(app, "Help").item(&item("check-updates", "Check for Updates\u{2026}", None)?).build()?;
        MenuBuilder::new(app).items(&[&file, &edit, &go, &view, &window, &help]).build()
    }
}

fn on_menu(app: &AppHandle, id: &str) {
    match id {
        "change-server" => {
            if let (Some(w), Ok(u)) = (app.get_webview_window(WINDOW), Url::parse(&format!("{PICKER}#server"))) {
                let _ = w.navigate(u);
            }
        }
        // Everything else is for the web app, which handles these ids in Shell.tsx.
        other => {
            let _ = app.emit("menu", other.to_string());
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Shell::default())
        .invoke_handler(tauri::generate_handler![
            get_server,
            probe_server,
            save_server,
            sign_in,
            sign_in_code,
            open_web_login,
            set_badge,
            notify,
            take_pending_url,
            open_external,
            check_update,
            install_update
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let saved = load_server(&handle);
            if let Ok(mut s) = handle.state::<Shell>().server.lock() {
                *s = saved.clone();
            }
            app.set_menu(build_menu(&handle)?)?;
            app.on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
            // Signed in already (the server's cookie is still in the window's store): open the server.
            // Otherwise the picker, which starts at the sign-in steps when a server is saved.
            let window = build_window(&handle, WebviewUrl::App("index.html".into()))?;
            if let Some(srv) = saved {
                let signed_in = has_session(&window, &srv);
                dlog!("saved server {} signed_in={}", srv, signed_in);
                if signed_in {
                    let _ = window.navigate(srv);
                }
            }
            let _ = window.show();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building imbox");

    app.run(|handle, event| match event {
        // The default mail app: macOS hands mailto: links here.
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            for u in urls {
                if let Some(path) = mailto_path(u.as_str()) {
                    queue_path(handle, path);
                }
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { has_visible_windows: false, .. } => show_main(handle),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_name_gets_https_and_loses_the_path() {
        assert_eq!(normalize_server("mail.example.com").unwrap().as_str(), "https://mail.example.com/");
        assert_eq!(normalize_server("  https://Mail.Example.com/inbox?x=1#y ").unwrap().as_str(), "https://mail.example.com/");
        assert_eq!(normalize_server("https://me:pw@mail.example.com:8443/a").unwrap().as_str(), "https://mail.example.com:8443/");
    }

    #[test]
    fn plain_http_only_for_this_machine() {
        assert!(normalize_server("http://mail.example.com").is_err());
        assert_eq!(normalize_server("localhost:5173").unwrap().as_str(), "http://localhost:5173/");
        assert_eq!(normalize_server("http://127.0.0.1:8787").unwrap().as_str(), "http://127.0.0.1:8787/");
        assert_eq!(normalize_server("https://localhost:8443").unwrap().as_str(), "https://localhost:8443/");
    }

    #[test]
    fn rejects_junk_and_other_schemes() {
        assert!(normalize_server("").is_err());
        assert!(normalize_server("   ").is_err());
        assert!(normalize_server("javascript:alert(1)").is_err());
        assert!(normalize_server("file:///etc/passwd").is_err());
        assert!(normalize_server("ftp://mail.example.com").is_err());
    }

    #[test]
    fn only_in_app_paths_are_queued() {
        assert_eq!(safe_app_path("/t/12"), Some("/t/12".into()));
        assert_eq!(safe_app_path("/compose?mailto=a%40b.c"), Some("/compose?mailto=a%40b.c".into()));
        assert_eq!(safe_app_path("//evil.example/x"), None);
        assert_eq!(safe_app_path("https://evil.example/x"), None);
        assert_eq!(safe_app_path("/\\evil.example"), None);
        assert_eq!(safe_app_path("t/12"), None);
    }

    #[test]
    fn mailto_becomes_a_compose_path() {
        assert_eq!(mailto_path("mailto:a@b.c").unwrap(), "/compose?mailto=mailto%3Aa%40b.c");
        assert_eq!(mailto_path("MAILTO:a@b.c?subject=Hi%20there").unwrap(), "/compose?mailto=MAILTO%3Aa%40b.c%3Fsubject%3DHi%2520there");
        assert!(mailto_path("https://example.com").is_none());
    }

    #[test]
    fn server_message_prefers_the_servers_words() {
        let st = reqwest::StatusCode::UNAUTHORIZED;
        assert_eq!(server_message(st, &serde_json::json!({ "message": "Invalid email or password." })), "Invalid email or password.");
        assert_eq!(server_message(st, &serde_json::Value::Null), "Sign in failed (401).");
        assert_eq!(server_message(st, &serde_json::json!({ "error": "x" })), "Sign in failed (401).");
    }

    #[test]
    fn app_pages_are_recognised() {
        assert!(is_app_page(&Url::parse("tauri://localhost/index.html").unwrap()));
        assert!(is_app_page(&Url::parse("http://tauri.localhost/").unwrap()));
        assert!(!is_app_page(&Url::parse("https://mail.example.com/").unwrap()));
        assert!(!is_app_page(&Url::parse("http://localhost:5173/").unwrap()));
    }
}
