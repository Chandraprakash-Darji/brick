use brick_span::{SourceFile, Span, Spanned, SymbolId};

#[test]
fn span_len_and_empty() {
    let s = Span::new(15, 22);
    assert_eq!(s.start, 15);
    assert_eq!(s.end, 22);
    assert_eq!(s.len(), 7);
    assert!(!s.is_empty());

    let empty = Span::new(5, 5);
    assert!(empty.is_empty());
    assert_eq!(empty.len(), 0);
}

#[test]
fn span_contains_offset() {
    let s = Span::new(15, 22);
    assert!(s.contains(15));
    assert!(s.contains(21));
    assert!(!s.contains(22));
    assert!(!s.contains(14));
}

#[test]
fn spanned_preserves_value_and_span() {
    let sp: Spanned<&str> = Spanned {
        value: "account",
        span: Span::new(15, 22),
    };
    assert_eq!(sp.value, "account");
    assert_eq!(sp.span.start, 15);
    assert_eq!(sp.span.end, 22);
}

#[test]
fn source_file_slice_returns_account() {
    let file = SourceFile::new("blog.brick", "owner = account");
    // "account" starts at byte 8 in "owner = account"
    let span = Span::new(8, 15);
    assert_eq!(file.slice(span), Some("account"));
}

#[test]
fn source_file_slice_rejects_out_of_bounds() {
    let file = SourceFile::new("blog.brick", "owner = account");
    assert_eq!(file.slice(Span::new(0, 100)), None);
    assert_eq!(file.slice(Span::new(16, 9)), None);
}

#[test]
fn symbol_id_equality_and_copy() {
    let a = SymbolId(42);
    let b = a;
    assert_eq!(a, b);
    assert_eq!(a.0, 42);
    assert_ne!(a, SymbolId(43));
}
