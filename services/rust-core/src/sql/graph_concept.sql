WITH needed AS MATERIALIZED (
    SELECT $5::uuid AS concept_id
    UNION
    SELECT target FROM cf_graph_read_edges
    WHERE tenant_id=$1 AND domain_id=$2 AND version=$3 AND origin=$5
), visible AS MATERIALIZED (
    SELECT n.concept_id FROM cf_graph_read_nodes n
    JOIN needed k USING(concept_id)
    WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3
      AND NOT EXISTS (
        SELECT 1 FROM cf_graph_read_sources r
        LEFT JOIN cf_sources s ON s.tenant_id=r.tenant_id AND s.domain_id=r.domain_id AND s.id=r.source_id
        WHERE r.tenant_id=n.tenant_id AND r.domain_id=n.domain_id AND r.version=n.version AND r.concept_id=n.concept_id
          AND (s.id IS NULL OR NOT(s.allowed_subjects ? $4))
      )
)
SELECT jsonb_set(n.concept,'{links}',coalesce((
    SELECT jsonb_agg(e.value ORDER BY e.ordinality)
    FROM jsonb_array_elements(n.concept->'links') WITH ORDINALITY e(value,ordinality)
    JOIN visible v ON v.concept_id=(e.value->>'target_id')::uuid
),'[]'::jsonb))
FROM cf_graph_read_nodes n JOIN visible v USING(concept_id)
WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3 AND n.concept_id=$5
