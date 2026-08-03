"""Safe expression evaluator (FR-2.2: "a small safe expression evaluator").

Real, not a stub: parses to a Python AST and walks a strict whitelist — names resolve
against the run state only; no imports, no attribute access, no calls, no dunder. Used by
router predicates and transform expressions.
"""
from __future__ import annotations

import ast
import operator
from typing import Any

_BIN = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_CMP = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le,
    ast.Gt: operator.gt, ast.GtE: operator.ge, ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}
_UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos, ast.Not: operator.not_}


class ExprError(ValueError):
    pass


def _eval(node: ast.AST, env: dict[str, Any]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval(node.body, env)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in env:
            return env[node.id]
        raise ExprError(f"unknown name '{node.id}'")
    if isinstance(node, ast.BinOp) and type(node.op) in _BIN:
        return _BIN[type(node.op)](_eval(node.left, env), _eval(node.right, env))
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
        return _UNARY[type(node.op)](_eval(node.operand, env))
    if isinstance(node, ast.BoolOp):
        vals = [_eval(v, env) for v in node.values]
        return all(vals) if isinstance(node.op, ast.And) else any(vals)
    if isinstance(node, ast.Compare):
        left = _eval(node.left, env)
        for op, right_node in zip(node.ops, node.comparators):
            right = _eval(right_node, env)
            if type(op) not in _CMP:
                raise ExprError(f"operator {type(op).__name__} not allowed")
            if not _CMP[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, (ast.List, ast.Tuple)):
        return [_eval(e, env) for e in node.elts]
    raise ExprError(f"disallowed expression: {type(node).__name__}")


def evaluate(expr: str, env: dict[str, Any]) -> Any:
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ExprError(f"syntax error: {e}") from e
    return _eval(tree, env)
