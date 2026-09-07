mod assets;mod cache;mod encoders;mod jobs;
use tauri::Manager;
#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){
    tauri::Builder::default().manage(assets::AssetAccess::default()).manage(encoders::EncoderConfig::default()).manage(jobs::Jobs::default())
    .on_window_event(|window,event|match event{
        tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop{paths,..})=>{if let Ok(mut dropped)=window.state::<assets::AssetAccess>().dropped.lock(){*dropped=paths.clone();}},
        tauri::WindowEvent::CloseRequested{api,..}=>{
            api.prevent_close();let app=window.app_handle().clone();
            let pending=window.state::<jobs::Jobs>().jobs.lock().map(|map|map.values().cloned().collect()).unwrap_or_default();
            tauri::async_runtime::spawn(async move{jobs::shutdown(pending).await;app.exit(0);});
        },_=>{}
    })
    .invoke_handler(tauri::generate_handler![assets::pick_assets,assets::import_dropped,assets::read_asset,assets::pick_destination,cache::cache_get,cache::cache_put,encoders::encoder_capabilities,encoders::configure_encoder,jobs::start_export,jobs::write_frame,jobs::finish_export,jobs::cancel_export,jobs::open_output])
    .run(tauri::generate_context!()).expect("Spine Studio startup failed");
}
