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

-- Fornecedor com a categoria mais comum (escolhida no painel; vira sugestao no lancamento).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
