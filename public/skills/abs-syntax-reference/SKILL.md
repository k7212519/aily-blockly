---
name: abs-syntax-reference
description: "ABS 语法快速参考：权威 ABS 规则与示例 skill，覆盖块连接类型、参数顺序、语句输入、变量引用与常见示例。触发词：ABS、语法、块脚本"
metadata:
  version: "1.0.0"
  author: aily-team
  scope: global
  agents: mainAgent
  auto-activate: false
  tags: abs,syntax,reference,blockly
---

# ABS (Aily Block Syntax) 快速参考

本 skill 现在是 ABS 语法的权威参考入口。
当需要 ABS 语法时，应通过 `load_skill({query: "abs-syntax"})` 或直接加载 `abs-syntax-reference` 来获取本指南。

## Block Connection Types

| Type | Role | Parameter Style |
|------|------|-----------------|
| **Value** | 作为值嵌入到其他块参数中 | 所有参数都写在括号内：`logic_compare($a, EQ, $b)` |
| **Statement** | 独立成行，通过 next 串联 | 普通参数写在括号内，语句输入使用 `@NAME:` |
| **Hat** | 根入口块，如 `arduino_setup`、`arduino_loop` | 规则与 Statement 相同 |

## Syntax Rules

| Element | Syntax | Example |
|---------|--------|---------|
| Block call | `block_type(param1, param2)` | `serial_println(Serial, text("Hi"))` |
| Empty params | `block_type()` | `time_millis()` |
| Statement input | `@NAME:` + 换行 + 缩进 | `@DO0:\n    action()` |
| Variable ref | `$varName` | `$count`, `$sensor` |

## Parameter Types

| Type | Syntax | Example |
|------|--------|---------|
| Dropdown | `ENUM_VALUE` | `Serial`, `HIGH`, `EQ`, `AND` |
| Text | `"string"` | `"hello"`, `"dht"` |
| Number | `123` | `9600`, `13` |
| Variable | `$name` | `$count`, `$temp` |
| Value block | `block(args)` | `math_number(10)`, `$var` |

## 参数顺序规则

**参数顺序必须严格遵循 block.json 中 `args0` 的定义顺序**，字段和输入可能交错出现，不能想当然地把下拉字段放到最前面。

例如 `logic_compare` 的 `args0` 顺序是：`A(input_value), OP(field_dropdown), B(input_value)`，因此：

- 正确：`logic_compare($a, EQ, $b)`
- 错误：`logic_compare(EQ, $a, $b)`

## Value Blocks

值块的所有参数都必须写在括号里，不能使用命名输入。

```abs
# Comparison: logic_compare(A, OP, B)
logic_compare($a, EQ, math_number(10))
logic_compare($temp, GT, math_number(30))

# Logic: logic_operation(A, OP, B)
logic_operation($sensor1, AND, $sensor2)
logic_operation(logic_compare($a, GT, math_number(0)), OR, logic_compare($a, LT, math_number(100)))

# Math: math_arithmetic(A, OP, B)
math_arithmetic($a, ADD, $b)

# Ternary: logic_ternary(condition, trueValue, falseValue)
logic_ternary(logic_compare($score, GTE, math_number(90)), text("A"), text("B"))

# Negate
logic_negate($flag)

# Boolean
logic_boolean(TRUE)
```

## Statement Blocks with Statement Inputs

语句输入必须使用 `@NAME:`，并且子块体使用 4 个空格缩进。

```abs
# If-Else: statement inputs use @NAME:
controls_if()
    @IF0: logic_compare($temp, GT, math_number(30))
    @DO0:
        serial_println(Serial, text("Hot"))
    @ELSE:
        serial_println(Serial, text("OK"))

# If-ElseIf-Else
controls_if()
    @IF0: logic_compare($v, GT, math_number(100))
    @DO0:
        action1()
    @IF1: logic_compare($v, GT, math_number(50))
    @DO1:
        action2()
    @ELSE:
        action3()

# Loop
controls_repeat_ext(math_number(10))
    serial_println(Serial, text("Loop"))

controls_for($i, math_number(0), math_number(10), math_number(1))
    serial_println(Serial, $i)
```

## Simple Statement Blocks

无语句输入的语句块，同样全部使用括号参数。

```abs
serial_begin(Serial, 115200)
serial_println(Serial, text("Hello"))
serial_println(Serial, $count)
time_delay(math_number(1000))
variables_set($count, math_number(0))
math_change($count, math_number(1))
```

## Program Structure

```abs
arduino_setup()
    serial_begin(Serial, 115200)

arduino_loop()
    serial_println(Serial, text("Hello"))
    time_delay(math_number(1000))
```

## Variable Reference Context

| Target Type | `$var` Becomes |
|-------------|-----------------|
| field_variable | 变量字段，如 `variables_set($x, ...)` |
| input_value | `variables_get` 表达式，如 `serial_println(Serial, $x)` |

## Checklist

- 必须写括号：`block()`，不能省略为 `block`
- `input_value` 位置的数字应写成 `math_number(n)`
- `input_value` 位置的文本应写成 `text("s")`
- 下拉值使用枚举值，如 `HIGH`、`Serial`、`EQ`、`AND`
- 语句体使用 4 空格缩进
- 只有语句输入才使用命名输入：`@IF0:`、`@DO0:`、`@ELSE:`
- 值块的所有参数都在括号里，不能写命名输入
- 参数顺序严格遵循 block.json 的 `args0` 定义，而不是“字段优先”

## 调试建议

1. 先加载 `abs-syntax-reference` skill，确认最新语法规则。
2. 使用 `sync_abs_file` 导出当前 ABS 内容并定位问题。
3. 对照 `args0` 顺序修正参数位置、缩进、值块包装方式。
4. 再导入验证，依据报错继续最小化修复。
