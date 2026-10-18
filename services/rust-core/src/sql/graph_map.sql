WITH source_facts AS MATERIALIZED (
 SELECT r.concept_id,
   jsonb_agg(s.content_hash ORDER BY s.content_hash) FILTER (WHERE s.id IS NOT NULL) AS source_hashes,
   bool_or(s.id IS NULL OR NOT(s.allowed_subjects ? $4)) AS forbidden
 FROM cf_graph_read_sources r
 LEFT JOIN cf_sources s ON s.tenant_id=r.tenant_id AND s.domain_id=r.domain_id AND s.id=r.source_id
 WHERE r.tenant_id=$1 AND r.domain_id=$2 AND r.version=$3
 GROUP BY r.concept_id
), visible AS MATERIALIZED (
 SELECT n.concept_id,n.title,n.maturity,encode(sha256(convert_to(n.concept->>'body','UTF8')),'hex') AS body_hash,
   coalesce(f.source_hashes,'[]'::jsonb) AS source_hashes
 FROM cf_graph_read_nodes n LEFT JOIN source_facts f USING(concept_id)
 WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3 AND NOT coalesce(f.forbidden,false)
), edges AS MATERIALIZED (
 SELECT e.origin,e.target,e.kind,e.weight FROM cf_graph_read_edges e
 JOIN visible a ON a.concept_id=e.origin JOIN visible b ON b.concept_id=e.target
 WHERE e.tenant_id=$1 AND e.domain_id=$2 AND e.version=$3
)
SELECT jsonb_build_object(
 'nodes',coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.concept_id) FROM (SELECT * FROM visible ORDER BY concept_id LIMIT 10001) n),'[]'::jsonb),
 'edges',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM (SELECT * FROM edges ORDER BY origin,target,kind LIMIT 200001) e),'[]'::jsonb)
)
