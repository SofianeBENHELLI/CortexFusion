-- Called only inside read_projection_transaction: domain, membership and all
-- existing source rows are locked. Return one hash, never a source/ACL list.
-- A rebuilt immutable projection changes its row incarnation, even if its
-- publication number and digest are unchanged.
SELECT encode(sha256(convert_to(jsonb_build_array(
 d.published_version, r.digest, r.created_at, r.xmin::text,
 (SELECT coalesce(jsonb_agg(jsonb_build_array(s.id,s.content_hash,s.allowed_subjects ? $3) ORDER BY s.id),'[]'::jsonb)
  FROM cf_sources s WHERE s.tenant_id=$1 AND s.domain_id=$2)
)::text,'UTF8')),'hex')
FROM cf_domains d LEFT JOIN cf_graph_read_versions r
 ON r.tenant_id=d.tenant_id AND r.domain_id=d.id AND r.version=d.published_version
WHERE d.tenant_id=$1 AND d.id=$2
