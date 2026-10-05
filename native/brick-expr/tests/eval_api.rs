use brick_expr::{EvalError, Expr, eval};

fn num(n: i64) -> Expr {
    Expr::Num(n)
}

fn add(l: Expr, r: Expr) -> Expr {
    Expr::Add(Box::new(l), Box::new(r))
}

fn mul(l: Expr, r: Expr) -> Expr {
    Expr::Mul(Box::new(l), Box::new(r))
}

fn div(l: Expr, r: Expr) -> Expr {
    Expr::Div(Box::new(l), Box::new(r))
}

#[test]
fn eval_num() {
    assert_eq!(eval(&num(7)), Ok(7));
}

#[test]
fn eval_precedence_via_nesting() {
    // 1 + 2 * 3 = 7
    let e = add(num(1), mul(num(2), num(3)));
    assert_eq!(eval(&e), Ok(7));
}

#[test]
fn eval_parens_via_nesting() {
    // (1 + 2) * 3 = 9
    let e = mul(add(num(1), num(2)), num(3));
    assert_eq!(eval(&e), Ok(9));
}

#[test]
fn eval_div_ok() {
    assert_eq!(eval(&div(num(7), num(2))), Ok(3));
}

#[test]
fn eval_div_by_zero_is_err() {
    assert_eq!(eval(&div(num(1), num(0))), Err(EvalError::DivisionByZero));
}

#[test]
fn eval_overflow_is_err() {
    assert_eq!(eval(&add(num(i64::MAX), num(1))), Err(EvalError::Overflow));
}
