use std::{collections::HashMap, path::{Path, PathBuf}, sync::Mutex};
use serde::Serialize;
use tauri::{ipc::Response, State};
use uuid::Uuid;
#[derive(Default)]
pub struct AssetAccess { pub roots: Mutex<HashMap<String,PathBuf>>, pub destinations: Mutex<HashMap<String,PathBuf>>, pub dropped: Mutex<Vec<PathBuf>> }
#[derive(Serialize)]
pub struct AssetFile { root: String, path: String, size: u64, modified: u64 }
fn scan(paths: Vec<PathBuf>, access: &AssetAccess) -> Result<Vec<AssetFile>,String> {
    let mut result=Vec::new();
    for selected in paths {
        let root=selected.canonicalize().map_err(|e|e.to_string())?;
        if !root.is_dir() { return Err("Select or drop asset directories.".into()); }
        let id={let mut roots=access.roots.lock().map_err(|e|e.to_string())?;
            if let Some((id,_))=roots.iter().find(|(_,p)|**p==root) {id.clone()} else {let id=Uuid::new_v4().to_string();roots.insert(id.clone(),root.clone());id}};
        for entry in walkdir::WalkDir::new(&root).follow_links(false).max_depth(32) {
            let entry=entry.map_err(|e|e.to_string())?; if !entry.file_type().is_file() {continue;}
            let ext=entry.path().extension().and_then(|e|e.to_str()).unwrap_or("").to_lowercase();
            if !["json","skel","atlas","png"].contains(&ext.as_str()) {continue;}
            if result.len()>=100_000 {return Err("Asset index exceeds 100,000 files.".into());}
            let metadata=entry.metadata().map_err(|e|e.to_string())?;
            result.push(AssetFile{root:id.clone(),path:entry.path().strip_prefix(&root).map_err(|e|e.to_string())?.to_string_lossy().replace('\\',"/"),size:metadata.len(),modified:metadata.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_millis() as u64).unwrap_or(0)});
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn pick_assets(access: State<'_,AssetAccess>) -> Result<Vec<AssetFile>,String> {
    let paths=rfd::AsyncFileDialog::new().set_title("Select Spine asset folders").pick_folders().await;
    match paths {Some(paths)=>scan(paths.iter().map(|p|p.path().to_path_buf()).collect(),&access),None=>Ok(Vec::new())}
}
#[tauri::command]
pub async fn import_dropped(paths: Vec<String>,access: State<'_,AssetAccess>) -> Result<Vec<AssetFile>,String> {
    let selected:Vec<PathBuf>=paths.into_iter().map(PathBuf::from).collect();
    {let mut allowed=access.dropped.lock().map_err(|e|e.to_string())?;
    if !selected.iter().all(|p|allowed.contains(p)) {return Err("Paths were not supplied by a native drop event.".into());}
    allowed.clear();}
    scan(selected,&access)
}
pub fn scoped(root:&Path,path:&str) -> Result<PathBuf,String> {
    let child=Path::new(path);
    if child.is_absolute() || child.components().any(|p|matches!(p,std::path::Component::ParentDir|std::path::Component::Prefix(_))) {return Err("Invalid relative path.".into());}
    let full=root.join(child).canonicalize().map_err(|e|e.to_string())?;
    if !full.starts_with(root) {return Err("Path escapes approved root.".into());} Ok(full)
}
#[tauri::command]
pub async fn read_asset(root:String,path:String,access:State<'_,AssetAccess>) -> Result<Response,String> {
    let base=access.roots.lock().map_err(|e|e.to_string())?.get(&root).cloned().ok_or("Unknown asset root")?;
    let path=scoped(&base,&path)?;
    let ext=path.extension().and_then(|e|e.to_str()).unwrap_or("").to_lowercase();
    if !["json","skel","atlas","png"].contains(&ext.as_str()) {return Err("Unsupported asset type.".into());}
    let metadata=tokio::fs::metadata(&path).await.map_err(|e|e.to_string())?;
    if metadata.len()>128*1024*1024 {return Err("Asset exceeds 128 MiB.".into());}
    // A bounded read also handles growth after metadata inspection.
    use tokio::io::AsyncReadExt;
    let file=tokio::fs::File::open(path).await.map_err(|e|e.to_string())?;
    let mut bytes=Vec::new();file.take(128*1024*1024+1).read_to_end(&mut bytes).await.map_err(|e|e.to_string())?;
    if bytes.len()>128*1024*1024 {return Err("Asset exceeds read budget.".into());} Ok(Response::new(bytes))
}
#[tauri::command]
pub async fn pick_destination(access:State<'_,AssetAccess>) -> Result<Option<String>,String> {
    if let Some(folder)=rfd::AsyncFileDialog::new().set_title("Export destination").pick_folder().await {
        let path=folder.path().canonicalize().map_err(|e|e.to_string())?;let id=Uuid::new_v4().to_string();
        access.destinations.lock().map_err(|e|e.to_string())?.insert(id.clone(),path);Ok(Some(id))
    } else {Ok(None)}
}
