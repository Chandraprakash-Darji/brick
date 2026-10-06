use crate::{
    callbacks::{CallbackRequest, CallbackResponse, Dispatcher, Header},
    server::{ServerConfig, build_router},
};
use napi::{
    bindgen_prelude::{Buffer, Promise},
    threadsafe_function::ThreadsafeFunction,
};
use napi_derive::napi;
use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

#[napi(object)]
pub struct BridgeHeader {
    pub name: String,
    pub value: String,
}
#[napi(object)]
pub struct BridgeRequest {
    pub binding_id: u32,
    pub method: String,
    pub url: String,
    pub headers: Vec<BridgeHeader>,
    pub params: String,
    pub query: String,
    pub body: Buffer,
    pub input: Option<String>,
    pub input_validated: bool,
    pub output_validated: bool,
}
#[napi(object)]
pub struct BridgeResponse {
    pub status: u32,
    pub headers: Vec<BridgeHeader>,
    pub body: Buffer,
    pub json: bool,
}
struct JsDispatcher {
    callback: ThreadsafeFunction<BridgeRequest, Promise<BridgeResponse>>,
}
impl Dispatcher for JsDispatcher {
    fn call(
        &self,
        r: CallbackRequest,
    ) -> Pin<Box<dyn Future<Output = Result<CallbackResponse, String>> + Send + '_>> {
        Box::pin(async move {
            let promise = self
                .callback
                .call_async_catch(Ok(BridgeRequest {
                    binding_id: r.binding_id,
                    method: r.method,
                    url: r.url,
                    params: r.params,
                    query: r.query,
                    body: r.body.into(),
                    input: r.input,
                    input_validated: r.input_validated,
                    output_validated: r.output_validated,
                    headers: r
                        .headers
                        .into_iter()
                        .map(|h| BridgeHeader {
                            name: h.name,
                            value: h.value,
                        })
                        .collect(),
                }))
                .await
                .map_err(|e| e.to_string())?;
            let r = promise.await.map_err(|e| e.to_string())?;
            let status = u16::try_from(r.status).map_err(|_| "invalid callback status")?;
            Ok(CallbackResponse {
                status,
                body: r.body.to_vec(),
                json: r.json,
                headers: r
                    .headers
                    .into_iter()
                    .map(|h| Header {
                        name: h.name,
                        value: h.value,
                    })
                    .collect(),
            })
        })
    }
}
#[napi]
pub struct NativeServer {
    port: u32,
    stop: Mutex<Option<oneshot::Sender<()>>>,
    done: Mutex<Option<oneshot::Receiver<Result<(), String>>>>,
}
#[napi]
impl NativeServer {
    #[napi(getter)]
    pub fn port(&self) -> u32 {
        self.port
    }
    #[napi]
    pub async fn stop(&self) -> napi::Result<()> {
        if let Some(stop) = self.stop.lock().unwrap().take() {
            let _ = stop.send(());
        }
        let done = self.done.lock().unwrap().take();
        if let Some(done) = done {
            done.await
                .map_err(|e| napi::Error::from_reason(e.to_string()))?
                .map_err(napi::Error::from_reason)?;
        }
        Ok(())
    }
}
impl Drop for NativeServer {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.get_mut().unwrap().take() {
            let _ = stop.send(());
        }
    }
}
#[napi]
pub async fn start_in_process(
    config: String,
    listen: String,
    callback: ThreadsafeFunction<BridgeRequest, Promise<BridgeResponse>>,
) -> napi::Result<NativeServer> {
    let config: ServerConfig =
        serde_json::from_str(&config).map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let (ready_tx, ready_rx) = oneshot::channel();
    let (stop_tx, mut stop_rx) = oneshot::channel();
    let (done_tx, done_rx) = oneshot::channel();
    std::thread::Builder::new()
        .name("brick-http".into())
        .spawn(move || {
            let run = || -> Result<(), String> {
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| e.to_string())?;
                runtime.block_on(async move {
                    let router = build_router(config, Some(Arc::new(JsDispatcher { callback })))
                        .map_err(|e| e.to_string())?;
                    let listener = tokio::net::TcpListener::bind(listen)
                        .await
                        .map_err(|e| e.to_string())?;
                    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
                    let _ = ready_tx.send(port);
                    tokio::select! {
                        result = axum::serve(listener, router) => result.map_err(|e| e.to_string()),
                        _ = &mut stop_rx => Ok(()),
                    }
                })
            };
            let _ = done_tx.send(run());
        })
        .map_err(|e| napi::Error::from_reason(e.to_string()))?;
    let port = match ready_rx.await {
        Ok(port) => port,
        Err(_) => {
            let error = done_rx
                .await
                .ok()
                .and_then(Result::err)
                .unwrap_or_else(|| "native listener failed".into());
            return Err(napi::Error::from_reason(error));
        }
    };
    Ok(NativeServer {
        port: u32::from(port),
        stop: Mutex::new(Some(stop_tx)),
        done: Mutex::new(Some(done_rx)),
    })
}
