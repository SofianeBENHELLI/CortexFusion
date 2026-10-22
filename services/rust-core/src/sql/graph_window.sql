WITH visible AS MATERIALIZED (
    SELECT n.concept_id, n.title, n.maturity,
      CASE WHEN $7::text IS NULL OR n.search_text->>0=$7 THEN 0
           WHEN position($7 in n.search_text->>0)=1 THEN 1
           WHEN position($7 in n.search_text->>0)>0 THEN 2 ELSE 3 END AS search_rank
    FROM cf_graph_read_nodes n
    WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3
      AND NOT EXISTS (
        SELECT 1 FROM cf_graph_read_sources r
        LEFT JOIN cf_sources s ON s.tenant_id=r.tenant_id AND s.domain_id=r.domain_id AND s.id=r.source_id
        WHERE r.tenant_id=n.tenant_id AND r.domain_id=n.domain_id AND r.version=n.version AND r.concept_id=n.concept_id
          AND (s.id IS NULL OR NOT(s.allowed_subjects ? $4))
      )
), edges AS MATERIALIZED (
    SELECT e.origin,e.target,e.kind,e.weight,e.is_primary
    FROM cf_graph_read_edges e
    JOIN visible a ON a.concept_id=e.origin JOIN visible b ON b.concept_id=e.target
    WHERE e.tenant_id=$1 AND e.domain_id=$2 AND e.version=$3
), outgoing AS (SELECT origin,count(*) AS degree FROM edges GROUP BY origin),
 incoming AS (SELECT target,count(*) AS degree FROM edges GROUP BY target),
 scope AS MATERIALIZED (
    SELECT v.* FROM visible v
    WHERE ($5::uuid IS NULL OR v.concept_id=$5
       OR EXISTS(SELECT 1 FROM edges e WHERE e.origin=$5 AND e.target=v.concept_id)
       OR (NOT $6::boolean AND EXISTS(SELECT 1 FROM edges e WHERE e.target=$5 AND e.origin=v.concept_id)))
      AND ($7::text IS NULL OR EXISTS (
        SELECT 1 FROM cf_graph_read_nodes n
        WHERE n.tenant_id=$1 AND n.domain_id=$2 AND n.version=$3 AND n.concept_id=v.concept_id
          AND (position($7 in n.search_text->>0)>0 OR position($7 in n.search_text->>1)>0)
      ))
), stream AS MATERIALIZED (
    SELECT concept_id,row_number() OVER(ORDER BY search_rank,concept_id)-1 AS pos
    FROM scope WHERE $5::uuid IS NULL OR concept_id<>$5
), bounds AS (
    SELECT ($11::bigint - CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END) AS size,
      CASE WHEN $8::uuid IS NOT NULL AND $7::text IS NOT NULL THEN (SELECT pos+1 FROM stream WHERE concept_id=$8)
           WHEN $9::uuid IS NOT NULL AND $7::text IS NOT NULL THEN greatest(0,(SELECT pos FROM stream WHERE concept_id=$9)-$11::bigint)
           WHEN $8::uuid IS NOT NULL THEN (SELECT count(*) FROM stream WHERE concept_id<=$8)
           WHEN $9::uuid IS NOT NULL THEN greatest(0,(SELECT count(*) FROM stream WHERE concept_id<$9)-($11::bigint-CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END))
           WHEN $10::uuid IS NOT NULL AND ($5::uuid IS NULL OR $10<>$5) THEN coalesce((SELECT pos FROM stream WHERE concept_id=$10)/($11::bigint-CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END)*($11::bigint-CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END),0)
           ELSE 0 END AS start
), selected AS MATERIALIZED (
    SELECT s.concept_id FROM stream s CROSS JOIN bounds b WHERE s.pos>=b.start AND s.pos<b.start+b.size
    UNION SELECT concept_id FROM scope WHERE concept_id=$5
), summaries AS (
    SELECT v.concept_id,v.search_rank,jsonb_build_object(
        'concept_id',v.concept_id,'title',v.title,'maturity',v.maturity,
        'source_count',(SELECT count(*) FROM cf_graph_read_sources r WHERE r.tenant_id=$1 AND r.domain_id=$2 AND r.version=$3 AND r.concept_id=v.concept_id),
        'outgoing_relations',coalesce(o.degree,0),'incoming_relations',coalesce(i.degree,0)) AS node
    FROM visible v JOIN selected s USING(concept_id)
    LEFT JOIN outgoing o ON o.origin=v.concept_id LEFT JOIN incoming i ON i.target=v.concept_id
), internal AS MATERIALIZED (
    SELECT e.* FROM edges e JOIN selected a ON a.concept_id=e.origin JOIN selected b ON b.concept_id=e.target
), limited_edges AS (
    SELECT jsonb_build_object('from',origin,'to',target,'kind',kind,'weight',weight,'primary',is_primary) AS edge
    FROM internal ORDER BY origin,target,CASE kind WHEN 'structural' THEN 0 ELSE 1 END LIMIT 120
)
SELECT jsonb_build_object(
    'valid_focus',$5::uuid IS NULL OR EXISTS(SELECT 1 FROM visible WHERE concept_id=$5),
    'valid_locate',$10::uuid IS NULL OR EXISTS(SELECT 1 FROM scope WHERE concept_id=$10),
    'valid_search_cursor',$7::text IS NULL OR (($8::uuid IS NULL OR EXISTS(SELECT 1 FROM stream WHERE concept_id=$8)) AND ($9::uuid IS NULL OR EXISTS(SELECT 1 FROM stream WHERE concept_id=$9))),
    'domain_id',$2,'at_version',$3,
    'visibility',(SELECT encode(sha256(convert_to('cortex-graph-window-v1'||$2,'UTF8')||int8send($3)||int8send(octet_length(convert_to($4,'UTF8'))::bigint)||convert_to($4,'UTF8')||coalesce(string_agg(uuid_send(concept_id),''::bytea ORDER BY concept_id),''::bytea)),'hex') FROM visible),
    'focus',(SELECT node FROM summaries WHERE concept_id=$5),
    'after',$8::uuid,'before',$9::uuid,'locate',$10::uuid,'limit',$11::bigint,
    'direction',CASE WHEN $6 THEN 'outgoing' ELSE 'both' END,
    'scope_ids',CASE WHEN $5::uuid IS NOT NULL AND $6 THEN coalesce((SELECT jsonb_agg(concept_id ORDER BY concept_id) FROM scope),'[]'::jsonb) ELSE NULL END,
    'domain_totals',jsonb_build_object('concepts',(SELECT count(*) FROM visible),'relations',(SELECT count(*) FROM edges)),
    'scope_totals',jsonb_build_object('concepts',(SELECT count(*) FROM scope),'relations',(SELECT count(*) FROM edges e JOIN scope s ON s.concept_id=e.origin)),
    'nodes',coalesce((SELECT jsonb_agg(node ORDER BY search_rank,concept_id) FROM summaries),'[]'::jsonb),
    'edges',coalesce((SELECT jsonb_agg(edge) FROM limited_edges),'[]'::jsonb),
    'next_after',CASE WHEN (SELECT count(*) FROM stream)>b.start+b.size THEN (SELECT concept_id FROM stream WHERE pos=b.start+b.size-1) ELSE NULL END,
    'previous_before',CASE WHEN b.start>0 THEN (SELECT concept_id FROM stream WHERE pos=b.start) ELSE NULL END,
    'internal_relations',(SELECT count(*) FROM internal),
    'boundary_outgoing_relations',(SELECT count(*) FROM edges e JOIN selected a ON a.concept_id=e.origin WHERE NOT EXISTS(SELECT 1 FROM selected b WHERE b.concept_id=e.target)),
    'edges_truncated',(SELECT count(*) FROM internal)>120
) FROM bounds b
