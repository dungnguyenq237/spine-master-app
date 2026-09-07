use tauri::{AppHandle,Manager,ipc::{Request,InvokeBody,Response}};
use std::path::PathBuf;
fn path(app:&AppHandle,key:&str)->Result<PathBuf,String>{
    if key.len()!=64||!key.bytes().all(|b|b.is_ascii_hexdigit()){return Err("Invalid cache key".into());}
    let dir=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("previews-v1");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir.join(key))
}
#[tauri::command]
pub async fn cache_get(app:AppHandle,key:String)->Result<Response,String>{let p=path(&app,&key)?;if tokio::fs::metadata(&p).await.map_err(|e|e.to_string())?.len()>2*1024*1024{return Err("Cache entry exceeds budget".into());}let bytes=tokio::fs::read(p).await.map_err(|e|e.to_string())?;Ok(Response::new(bytes))}
#[tauri::command]
pub async fn cache_put(app:AppHandle,request:Request<'_>)->Result<(),String>{
    let key=request.headers().get("x-cache-key").and_then(|v|v.to_str().ok()).ok_or("Missing cache key")?;
    let bytes=match request.body(){InvokeBody::Raw(b)=>b,_=>return Err("Expected binary data".into())};
    if bytes.len()>2*1024*1024{return Err("Preview exceeds 2 MiB".into());}
    let p=path(&app,key)?;tokio::fs::write(&p,bytes).await.map_err(|e|e.to_string())?;
    let mut entries=std::fs::read_dir(p.parent().ok_or("Cache directory missing")?).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.metadata().ok().map(|m|(e.path(),m.len(),m.modified().ok()))).collect::<Vec<_>>();
    entries.sort_by_key(|e|e.2);let mut size:u64=entries.iter().map(|e|e.1).sum();
    for (path,len,_) in entries {if size<=256*1024*1024{break;}if std::fs::remove_file(path).is_ok(){size=size.saturating_sub(len);}}
    Ok(())
}
