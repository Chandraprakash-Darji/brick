pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    pub fn new(start: u32, end: u32) -> Self {
        Self { start, end }
    }

    pub fn len(&self) -> u32 {
        self.end.saturating_sub(self.start)
    }

    pub fn is_empty(&self) -> bool {
        self.start == self.end
    }

    pub fn contains(&self, offset: u32) -> bool {
        offset >= self.start && offset < self.end
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]

pub struct SymbolId(pub u32);

impl SymbolId {
    pub fn new(id: u32) -> Self {
        Self(id)
    }
}

pub struct SourceFile {
    pub name: String,
    pub text: String,
}

impl SourceFile {
    pub fn new(name: &str, text: &str) -> Self {
        Self {
            name: name.to_string(),
            text: text.to_string(),
        }
    }
    pub fn slice(&self, span: Span) -> Option<&str> {
        self.text.get(span.start as usize..span.end as usize)
    }
}

pub struct Spanned<T> {
    pub value: T,
    pub span: Span,
}
