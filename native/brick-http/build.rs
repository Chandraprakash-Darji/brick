fn main() {
    #[cfg(feature = "bridge")]
    napi_build::setup();
}
