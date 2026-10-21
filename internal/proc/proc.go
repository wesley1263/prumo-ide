// Package proc define como a IDE sobe processos filhos (gopls, Delve, go build/test, o programa do usuário).
//
// Regra: nenhum filho sobrevive ao backend. Se o backend morrer (inclusive à força, sem rodar o
// shutdown), os filhos morrem junto; sem isso, cada queda deixa gopls órfãos ocupando memória.
package proc
