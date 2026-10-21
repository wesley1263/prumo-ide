#!/usr/bin/env bash
# Cria um projeto Go de exemplo com histórico git, para desenvolver e testar a IDE.
#   scripts/seed-fixture.sh [destino]   (padrão: ./.fixtures/demo-shop)
set -euo pipefail
dest="${1:-.fixtures/demo-shop}"
rm -rf "$dest" && mkdir -p "$dest/cmd/shop" "$dest/internal/cart" "$dest/internal/catalog"
cd "$dest"
cat > go.mod <<'GO'
module example.com/demo-shop

go 1.22
GO
cat > internal/catalog/catalog.go <<'GO'
// Package catalog lista os produtos da loja.
package catalog

// Product é um item à venda. Price em centavos.
type Product struct {
	SKU   string
	Name  string
	Price int
}

// All devolve o catálogo fixo da demonstração.
func All() []Product {
	return []Product{
		{SKU: "CAF-01", Name: "Café torrado 500g", Price: 3490},
		{SKU: "CHA-07", Name: "Chá verde 20 sachês", Price: 1290},
		{SKU: "CAN-02", Name: "Caneca esmaltada", Price: 5900},
	}
}

// Find procura um produto pelo SKU.
func Find(sku string) (Product, bool) {
	for _, p := range All() {
		if p.SKU == sku {
			return p, true
		}
	}
	return Product{}, false
}
GO
cat > internal/cart/cart.go <<'GO'
// Package cart soma itens de um carrinho.
package cart

import (
	"fmt"

	"example.com/demo-shop/internal/catalog"
)

// Line é um produto e a quantidade.
type Line struct {
	Product catalog.Product
	Qty     int
}

// Cart é um carrinho de compras.
type Cart struct {
	lines []Line
}

// Add coloca qty unidades do SKU no carrinho.
func (c *Cart) Add(sku string, qty int) error {
	p, ok := catalog.Find(sku)
	if !ok {
		return fmt.Errorf("produto %s não existe", sku)
	}
	c.lines = append(c.lines, Line{Product: p, Qty: qty})
	return nil
}

// Total devolve o total em centavos.
func (c *Cart) Total() int {
	total := 0
	for _, l := range c.lines {
		total += l.Product.Price * l.Qty
	}
	return total
}
GO
cat > internal/cart/cart_test.go <<'GO'
package cart

import "testing"

func TestTotal(t *testing.T) {
	var c Cart
	if err := c.Add("CAF-01", 2); err != nil {
		t.Fatal(err)
	}
	if got := c.Total(); got != 6980 {
		t.Fatalf("Total = %d", got)
	}
}
GO
cat > cmd/shop/main.go <<'GO'
package main

import (
	"fmt"
	"os"

	"example.com/demo-shop/internal/cart"
)

func main() {
	var c cart.Cart
	for _, sku := range []string{"CAF-01", "CAN-02"} {
		if err := c.Add(sku, 1); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
	}
	fmt.Printf("Total: R$ %d,%02d\n", c.Total()/100, c.Total()%100)
}
GO
printf '# demo-shop\n\nProjeto de exemplo para desenvolver a IDE.\n' > README.md
git init -q -b main
git -c user.name=Demo -c user.email=demo@example.com add -A
git -c user.name=Demo -c user.email=demo@example.com commit -qm "catálogo e carrinho"
printf '\n// Count devolve quantos produtos existem.\nfunc Count() int { return len(All()) }\n' >> internal/catalog/catalog.go
echo "TODO: frete" > NOTES.md
echo "fixture em $(pwd)"
