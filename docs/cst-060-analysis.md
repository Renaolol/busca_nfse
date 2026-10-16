# Leitor CST 060

O endpoint `GET /nfe/cst-060-analysis` analisa itens CST 060 das NF-e recebidas e calcula o ICMS comparado ao valor retido no XML.

## Base de cálculo e alíquota

- Quando o XML informa `vBCSTRet`, o leitor usa essa base até o limite do valor total do produto (`vProd`). Se `vBCSTRet` for maior que `vProd`, a base usada será `vProd`. Se for menor, o leitor preserva o valor menor do XML.
- Quando o XML não informa `vBCSTRet`, o leitor mantém a base anterior: valor do produto menos desconto (`vProd - vDesc`).
- Quando o XML informa `pST`, essa alíquota é usada no recálculo. Sem `pST`, o leitor usa a alíquota interna informada na consulta, mantendo a regra automática de 4% para pneus.
- Itens sem ICMS ST retido (`vICMSSTRet` igual a zero) continuam com ICMS recalculado igual a zero.

Os valores `vBCSTRet` e `pST` também são retornados no item da resposta para conferência.
