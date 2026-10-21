// node --test: o texto gerado pelo Alt+Insert.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constructorFor, paramName, testFor } from './generateNames.ts'

test('paramName: minúscula, siglas e palavras reservadas', () => {
  assert.equal(paramName('Price'), 'price')
  assert.equal(paramName('SKU'), 'sku')
  assert.equal(paramName('HTTPClient'), 'httpClient')
  assert.equal(paramName('type'), 'typ')
  assert.equal(paramName('lines'), 'lines')
})

test('constructorFor: um parâmetro por campo', () => {
  const s = constructorFor('Line', [
    { name: 'Product', type: 'catalog.Product' },
    { name: 'Qty', type: 'int' },
  ])
  assert.match(s, /func NewLine\(product catalog\.Product, qty int\) \*Line \{/)
  assert.match(s, /return &Line\{Product: product, Qty: qty\}/)
})

test('testFor: método vira TestTipo_Metodo', () => {
  assert.match(testFor('Total', 'Cart'), /func TestCart_Total\(t \*testing\.T\)/)
  assert.match(testFor('Find'), /func TestFind\(t \*testing\.T\)/)
})
