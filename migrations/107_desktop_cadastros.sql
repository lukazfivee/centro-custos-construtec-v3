-- Desktop novo, D5 (Cadastros). So aditiva.
-- Categoria com cor (paleta fixa validada no servidor) e descricao.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(7);
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description VARCHAR(200);

-- Modelo recorrente com o mes da primeira parcela: a geracao passa a ser por mes
-- (a parcela k cai em inicio + (k-1) x intervalo), em vez de k-esimo mes do ano corrente.
-- Modelos existentes: a proxima parcela cai no mes em que o modelo foi criado.
ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS starts_on DATE;
UPDATE recurring_templates
   SET starts_on = (
     date_trunc('month', created_at AT TIME ZONE 'America/Sao_Paulo')
       - make_interval(months => (GREATEST(current_installment, 1) - 1) * (CASE frequency
           WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3 WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 ELSE 1 END))
   )::date
 WHERE starts_on IS NULL;

-- Fotografia do contador legado no momento da migracao. Parcelas anteriores a
-- esse limite continuam marcadas como geradas sem deduzir origem por descricao.
-- O limite permanece fixo: meses pulados depois da migracao podem ser gerados.
ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS legacy_generated_through INTEGER
  CHECK (legacy_generated_through >= 0);
UPDATE recurring_templates SET legacy_generated_through = GREATEST(current_installment - 1, 0)
  WHERE legacy_generated_through IS NULL;
ALTER TABLE recurring_templates ALTER COLUMN legacy_generated_through SET DEFAULT 0;
ALTER TABLE recurring_templates ALTER COLUMN legacy_generated_through SET NOT NULL;

-- Fornecedor com a categoria mais comum (escolhida no painel; vira sugestao no lancamento).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;

-- O vinculo explicito evita confundir modelos homonimos e lancamentos manuais.
-- Historico anterior permanece sem vinculo; nao e seguro inferir sua origem pela descricao.
-- Sem FK: modelos podem ser excluidos, mas o ID original deve permanecer no lancamento.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_template_id INTEGER;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS recurring_period DATE;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_recurring_period_unique
  ON transactions (recurring_template_id, recurring_period)
  WHERE recurring_template_id IS NOT NULL AND deleted_at IS NULL;

-- Documentos legados duplicados impedem o indice e exigem conciliacao explicita.
-- A migracao nao apaga nem reatribui documentos para resolver conflitos antigos.
-- Pre-verificacao: SELECT regexp_replace(document, '[^0-9]', '', 'g') AS numero,
--   COUNT(*) AS quantidade, array_agg(id ORDER BY id) AS fornecedores
--   FROM suppliers WHERE document IS NOT NULL
--   GROUP BY 1 HAVING COUNT(*) > 1 AND regexp_replace(document, '[^0-9]', '', 'g') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_document_digits_unique
  ON suppliers (regexp_replace(COALESCE(document, ''), '[^0-9]', '', 'g'))
  WHERE document IS NOT NULL AND regexp_replace(document, '[^0-9]', '', 'g') <> '';
