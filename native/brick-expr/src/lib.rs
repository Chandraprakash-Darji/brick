use crate::EvalError::Overflow;

pub enum Expr {
    Num(i64),
    Add(Box<Expr>, Box<Expr>),
    Mul(Box<Expr>, Box<Expr>),
    Div(Box<Expr>, Box<Expr>),
}

#[derive(Debug, PartialEq)]
pub enum EvalError {
    // Error when dividing by zero
    DivisionByZero,
    // Error when an operation overflows
    Overflow,
}

pub fn eval(expr: &Expr) -> Result<i64, EvalError> {
    match expr {
        Expr::Num(num) => Ok(*num),
        Expr::Add(expr_a, expr_b) => {
            Ok(eval(&expr_a)?.checked_add(eval(&expr_b)?).ok_or(Overflow)?)
        }
        Expr::Mul(expr_a, expr_b) => {
            Ok(eval(&expr_a)?.checked_mul(eval(&expr_b)?).ok_or(Overflow)?)
        }
        Expr::Div(expr_a, expr_b) => {
            let evaulted_b = eval(&expr_b);
            if evaulted_b == Ok(0) {
                return Err(EvalError::DivisionByZero);
            }
            Ok(eval(&expr_a)?.checked_div(evaulted_b?).ok_or(Overflow)?)
        }
    }
}
