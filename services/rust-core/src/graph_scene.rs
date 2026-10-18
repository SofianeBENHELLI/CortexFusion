//! Authorized, bounded spatial views. Placement is deterministic within a
//! publication; aggregation happens before transport, never in the browser.
use crate::{error::CoreError, graph_map, server::StateData};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use http::{HeaderMap, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, Instant},
};
use uuid::Uuid;

const MAX_BYTES: usize = 65_536;
const MAX_CELLS: usize = 16;
const MAX_LANDMARKS: usize = 8;
const MAX_LINKS: usize = 120;
const PAGE_SIZE: usize = 16;
const SEARCH_PAGE_SIZE: usize = 8;
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    layout: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
    focus: Option<String>,
    target: Option<String>,
    search: Option<String>,
    direction: Option<String>,
    kind: Option<String>,
    offset: Option<usize>,
    at_version: Option<i64>,
    visibility: Option<String>,
}
fn invalid() -> CoreError {
    CoreError {
        code: "INVALID_SCENE_QUERY",
        message: "Invalid spatial view parameters",
        status: StatusCode::UNPROCESSABLE_ENTITY,
    }
}
fn changed() -> CoreError {
    CoreError {
        code: "GRAPH_WINDOW_CHANGED",
        message: "Graph version or visibility changed; refresh the graph",
        status: StatusCode::CONFLICT,
    }
}
impl Request {
    fn validate(&self) -> Result<(), CoreError> {
        if self
            .layout
            .as_deref()
            .is_some_and(|v| !["territories", "fireworks", "circle", "lines"].contains(&v))
            || self
                .direction
                .as_deref()
                .is_some_and(|v| !["both", "in", "out"].contains(&v))
            || self
                .kind
                .as_deref()
                .is_some_and(|v| !["all", "reference", "structural", "associative"].contains(&v))
            || self
                .focus
                .as_ref()
                .is_some_and(|v| Uuid::parse_str(v).is_err())
            || self
                .target
                .as_ref()
                .is_some_and(|v| self.focus.is_none() || Uuid::parse_str(v).is_err())
            || self
                .search
                .as_ref()
                .is_some_and(|v| v.chars().count() > 200)
            || self.offset.is_some_and(|v| v > 400_000)
            || self.at_version.is_some_and(|v| v < 0)
            || self
                .visibility
                .as_ref()
                .is_some_and(|v| v.len() != 64 || !v.bytes().all(|b| b.is_ascii_hexdigit()))
            || (self.offset.unwrap_or(0) > 0
                && (self.at_version.is_none() || self.visibility.is_none()))
        {
            return Err(invalid());
        }
        let box_values = [self.x, self.y, self.w, self.h];
        if box_values.iter().any(Option::is_some)
            && (box_values.iter().any(Option::is_none)
                || box_values
                    .iter()
                    .flatten()
                    .any(|v| !v.is_finite() || v.abs() > 1e9)
                || self.w.unwrap_or(0.0) <= 0.0
                || self.h.unwrap_or(0.0) <= 0.0)
        {
            return Err(invalid());
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Default, Debug, Serialize)]
struct Point {
    x: f64,
    y: f64,
}
#[derive(Clone, Copy, Debug, Serialize)]
struct Bounds {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
impl Bounds {
    fn from_points(points: impl Iterator<Item = Point>) -> Self {
        let mut b = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in points {
            b.0 = b.0.min(p.x);
            b.1 = b.1.min(p.y);
            b.2 = b.2.max(p.x);
            b.3 = b.3.max(p.y);
        }
        if !b.0.is_finite() {
            return Self {
                x: -100.0,
                y: -100.0,
                w: 200.0,
                h: 200.0,
            };
        }
        Self {
            x: b.0 - 30.0,
            y: b.1 - 30.0,
            w: (b.2 - b.0 + 60.0).max(120.0),
            h: (b.3 - b.1 + 60.0).max(120.0),
        }
    }
    fn contains(&self, p: Point) -> bool {
        p.x >= self.x && p.y >= self.y && p.x <= self.x + self.w && p.y <= self.y + self.h
    }
    fn intersects(&self, b: Self) -> bool {
        b.x + b.w >= self.x
            && b.y + b.h >= self.y
            && b.x <= self.x + self.w
            && b.y <= self.y + self.h
    }
}
struct Group {
    members: Vec<usize>,
    p: Point,
    r: f64,
}
struct World {
    points: Vec<Point>,
    degree: Vec<usize>,
    incident: Vec<Vec<usize>>,
    bounds: Bounds,
    by_id: BTreeMap<String, usize>,
    folded: Vec<(String, String)>,
}
fn place(data: &Value, layout: &str) -> World {
    let nodes = data["nodes"].as_array().unwrap();
    let edges = data["edges"].as_array().unwrap();
    let mut families: BTreeMap<(String, String), Vec<usize>> = BTreeMap::new();
    for (i, n) in nodes.iter().enumerate() {
        families
            .entry((
                n["territory"].as_str().unwrap().into(),
                n["group"].as_str().unwrap().into(),
            ))
            .or_default()
            .push(i);
    }
    let count = families.len();
    let radius = (count as f64 * 24.0).max(500.0);
    let mut groups: Vec<Group> = families
        .into_values()
        .enumerate()
        .map(|(i, mut members)| {
            members.sort_by(|&a, &b| nodes[a]["id"].as_str().cmp(&nodes[b]["id"].as_str()));
            let a = i as f64 / count.max(1) as f64 * std::f64::consts::TAU
                - std::f64::consts::FRAC_PI_2;
            Group {
                r: (members.len() as f64).sqrt().mul_add(20.0, 0.0).max(90.0),
                members,
                p: Point {
                    x: a.cos() * radius,
                    y: a.sin() * radius,
                },
            }
        })
        .collect();
    let mut group_of = vec![0; nodes.len()];
    let mut degree = vec![0; nodes.len()];
    let mut incident = vec![vec![]; nodes.len()];
    for (i, g) in groups.iter().enumerate() {
        for &n in &g.members {
            group_of[n] = i;
        }
    }
    let mut macro_edges = BTreeSet::new();
    for (i, e) in edges.iter().enumerate() {
        let a = e[0].as_u64().unwrap() as usize;
        let b = e[1].as_u64().unwrap() as usize;
        degree[a] += 1;
        degree[b] += 1;
        incident[a].push(i);
        if a != b {
            incident[b].push(i);
        }
        if group_of[a] != group_of[b] {
            macro_edges.insert((group_of[a].min(group_of[b]), group_of[a].max(group_of[b])));
        }
    }
    if groups.len() > 128 || layout == "lines" {
        let width = (groups
            .iter()
            .map(|g| (g.r * 2.0 + 120.0).powi(2))
            .sum::<f64>())
        .sqrt()
            * 1.2;
        let (mut x, mut y, mut row) = (0.0, 0.0, 0.0f64);
        for g in &mut groups {
            let size = g.r * 2.0 + 120.0;
            if x > 0.0 && x + size > width {
                x = 0.0;
                y += row;
                row = 0.0;
            }
            g.p = Point {
                x: x + size / 2.0,
                y: y + size / 2.0,
            };
            x += size;
            row = row.max(size);
        }
    } else if layout == "territories" {
        for _ in 0..180 {
            let mut force = vec![Point::default(); groups.len()];
            for i in 0..groups.len() {
                for j in i + 1..groups.len() {
                    let a = &groups[i];
                    let b = &groups[j];
                    let dx = a.p.x - b.p.x;
                    let dy = a.p.y - b.p.y;
                    let d = dx.hypot(dy).max(1.0);
                    let ideal = a.r + b.r + 110.0;
                    let f =
                        (12.0 * ideal * ideal / (d * d) + (ideal - d).max(0.0) * 0.2).min(120.0);
                    force[i].x += dx / d * f;
                    force[i].y += dy / d * f;
                    force[j].x -= dx / d * f;
                    force[j].y -= dy / d * f;
                }
            }
            for &(i, j) in &macro_edges {
                let a = &groups[i];
                let b = &groups[j];
                let dx = b.p.x - a.p.x;
                let dy = b.p.y - a.p.y;
                let d = dx.hypot(dy).max(1.0);
                let f = (d - a.r - b.r - 140.0).max(0.0) * 0.001;
                force[i].x += dx / d * f;
                force[i].y += dy / d * f;
                force[j].x -= dx / d * f;
                force[j].y -= dy / d * f;
            }
            for (g, f) in groups.iter_mut().zip(force) {
                g.p.x += (f.x - g.p.x * 0.002) * 0.7;
                g.p.y += (f.y - g.p.y * 0.002) * 0.7;
            }
        }
    }
    let mut points = vec![Point::default(); nodes.len()];
    for g in groups {
        let len = g.members.len();
        for (i, n) in g.members.into_iter().enumerate() {
            let a = i as f64 * 2.399963229728653;
            let r = ((i as f64 + 0.5) / len as f64).sqrt() * g.r;
            points[n] = if layout == "circle" {
                let t = i as f64 / len as f64 * std::f64::consts::TAU;
                Point {
                    x: g.p.x + t.cos() * g.r,
                    y: g.p.y + t.sin() * g.r,
                }
            } else if layout == "lines" {
                let cols = (len as f64).sqrt().ceil() as usize;
                Point {
                    x: g.p.x + (i as f64 % cols as f64 - cols as f64 / 2.0) * 30.0,
                    y: g.p.y + ((i / cols) as f64 - cols as f64 / 2.0) * 30.0,
                }
            } else {
                Point {
                    x: g.p.x + a.cos() * r,
                    y: g.p.y + a.sin() * r,
                }
            };
        }
    }
    let bounds = Bounds::from_points(points.iter().copied());
    let by_id = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n["id"].as_str().unwrap().to_owned(), i))
        .collect();
    let folded = nodes
        .iter()
        .map(|n| {
            (
                crate::lexical::casefold(n["title"].as_str().unwrap()),
                crate::lexical::casefold(&format!(
                    "{}\n{}\n{}",
                    n["title"].as_str().unwrap(),
                    n["group"].as_str().unwrap(),
                    n["territory"].as_str().unwrap()
                )),
            )
        })
        .collect();
    World {
        bounds,
        by_id,
        folded,
        points,
        degree,
        incident,
    }
}
fn meta(data: &Value, world: &World, i: usize) -> Value {
    let mut n = data["nodes"][i].clone();
    n["x"] = json!(world.points[i].x);
    n["y"] = json!(world.points[i].y);
    n["degree"] = json!(world.degree[i]);
    n
}
fn envelope(data: &Value, visibility: &str, world: &World) -> Value {
    json!({"domain_id":data["domain_id"],"at_version":data["at_version"],"visibility":visibility,"totals":{"concepts":data["nodes"].as_array().unwrap().len(),"relations":data["published_relations"],"references":data["documentary_references"]},"bounds":world.bounds})
}
fn scene(data: &Value, world: &World, q: &Request, visibility: &str) -> Value {
    let nodes = data["nodes"].as_array().unwrap();
    let edges = data["edges"].as_array().unwrap();
    let all_bounds = world.bounds;
    let viewport = if let (Some(x), Some(y), Some(w), Some(h)) = (q.x, q.y, q.w, q.h) {
        Bounds { x, y, w, h }
    } else {
        all_bounds
    };
    // Power-of-two world cells retain their membership and position while panning.
    let mut cell = 2f64.powf((viewport.w.max(viewport.h) / 10.0).max(0.5).log2().ceil());
    let mut buckets;
    loop {
        let mut map: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
        for (i, &p) in world.points.iter().enumerate() {
            let key = ((p.x / cell).floor() as i64, (p.y / cell).floor() as i64);
            map.entry(key).or_default().push(i);
        }
        map.retain(|&(x, y), _| {
            viewport.intersects(Bounds {
                x: x as f64 * cell,
                y: y as f64 * cell,
                w: cell,
                h: cell,
            })
        });
        if map.len() <= MAX_CELLS || cell > 1e10 {
            buckets = map;
            break;
        }
        cell *= 2.0;
    }
    let mut glyphs = vec![];
    let mut owners = vec![None; nodes.len()];
    for ((x, y), members) in &mut buckets {
        let idx = glyphs.len();
        let count = members.len();
        for &i in members.iter() {
            owners[i] = Some(idx);
        }
        let center = Point {
            x: members.iter().map(|&i| world.points[i].x).sum::<f64>() / count as f64,
            y: members.iter().map(|&i| world.points[i].y).sum::<f64>() / count as f64,
        };
        let n = members[0];
        let same_group = members
            .iter()
            .all(|&i| nodes[i]["group"] == nodes[n]["group"]);
        glyphs.push(json!({"id":if count==1 {nodes[n]["id"].as_str().unwrap().to_owned()}else{format!("cell:{cell}:{x}:{y}")},"concept_id":if count==1{nodes[n]["id"].clone()}else{Value::Null},"title":if count==1{nodes[n]["title"].clone()}else if same_group{nodes[n]["group"].clone()}else{json!("Concepts")},"x":center.x,"y":center.y,"count":count,"bounds":Bounds::from_points(members.iter().map(|&i|world.points[i])),"degree":members.iter().map(|&i|world.degree[i]).sum::<usize>()}));
    }
    // A small landmark layer exposes actual cities/routes even at overview scale.
    let selected = q.focus.as_ref().and_then(|s| world.by_id.get(s).copied());
    let target = q.target.as_ref().and_then(|s| world.by_id.get(s).copied());
    let neighbors: BTreeSet<usize> = selected
        .map(|f| {
            world.incident[f]
                .iter()
                .flat_map(|&j| {
                    let e = &edges[j];
                    [
                        e[0].as_u64().unwrap() as usize,
                        e[1].as_u64().unwrap() as usize,
                    ]
                })
                .collect()
        })
        .unwrap_or_default();
    let mut ranked: Vec<_> = (0..nodes.len())
        .filter(|&i| viewport.contains(world.points[i]))
        .collect();
    ranked.sort_by_key(|&i| {
        (
            std::cmp::Reverse(Some(i) == selected || Some(i) == target),
            std::cmp::Reverse(neighbors.contains(&i)),
            std::cmp::Reverse(world.degree[i]),
            i,
        )
    });
    let mut landmark_map = BTreeMap::new();
    for i in ranked.into_iter().take(MAX_LANDMARKS) {
        if let Some(owner) = owners[i] {
            if glyphs[owner]["concept_id"].is_string() {
                landmark_map.insert(i, owner);
                continue;
            }
        }
        let idx = glyphs.len();
        landmark_map.insert(i, idx);
        let p = world.points[i];
        glyphs.push(json!({"id":nodes[i]["id"],"concept_id":nodes[i]["id"],"title":nodes[i]["title"],"x":p.x,"y":p.y,"count":1,"bounds":Bounds::from_points([p].into_iter()),"degree":world.degree[i]}));
    }
    let mut routes: BTreeMap<(usize, usize, String), usize> = BTreeMap::new();
    let mut links = vec![];
    for e in edges {
        let a = e[0].as_u64().unwrap() as usize;
        let b = e[1].as_u64().unwrap() as usize;
        if let (Some(&a), Some(&b)) = (landmark_map.get(&a), landmark_map.get(&b)) {
            links.push(
                json!({"from":a,"to":b,"kind":e[2],"count":1,"weight":e[3],"aggregate":false}),
            );
        }
        if let (Some(a), Some(b)) = (owners[a], owners[b]) {
            if a != b {
                *routes
                    .entry((a, b, e[2].as_str().unwrap().to_owned()))
                    .or_default() += 1;
            }
        }
    }
    let selected_glyph = selected.and_then(|s| landmark_map.get(&s).copied());
    let target_glyph = target.and_then(|s| landmark_map.get(&s).copied());
    links.sort_by_key(|e| {
        let pair = selected_glyph.zip(target_glyph).is_some_and(|(a, b)| {
            (e["from"].as_u64() == Some(a as u64) && e["to"].as_u64() == Some(b as u64))
                || (e["from"].as_u64() == Some(b as u64) && e["to"].as_u64() == Some(a as u64))
        });
        (
            std::cmp::Reverse(pair),
            std::cmp::Reverse(selected_glyph.is_some_and(|s| {
                e["from"].as_u64() == Some(s as u64) || e["to"].as_u64() == Some(s as u64)
            })),
        )
    });
    links.truncate(MAX_LINKS / 2);
    let mut routes: Vec<_> = routes.into_iter().collect();
    routes.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
    let routes_total = routes.len();
    for ((a, b, kind), count) in routes.into_iter().take(MAX_LINKS - links.len()) {
        links.push(
            json!({"from":a,"to":b,"kind":kind,"count":count,"weight":null,"aggregate":true}),
        );
    }
    for glyph in &mut glyphs {
        let title = glyph["title"].as_str().unwrap();
        if title.chars().count() > 100 {
            glyph["title"] = json!(format!("{}…", title.chars().take(99).collect::<String>()));
        }
    }
    let mut v = envelope(data, visibility, world);
    v["glyphs"] = json!(glyphs);
    v["links"] = json!(links);
    v["view"] = json!(viewport);
    v["cell_size"] = json!(cell);
    v["routes_total"] = json!(routes_total);
    v["coverage"] = json!("viewport");
    v
}
fn listing(data: &Value, world: &World, q: &Request, visibility: &str) -> Result<Value, CoreError> {
    let nodes = data["nodes"].as_array().unwrap();
    let edges = data["edges"].as_array().unwrap();
    let focus = q
        .focus
        .as_ref()
        .map(|id| {
            world
                .by_id
                .get(id)
                .copied()
                .ok_or_else(CoreError::not_found)
        })
        .transpose()?;
    let target = q
        .target
        .as_ref()
        .map(|id| {
            world
                .by_id
                .get(id)
                .copied()
                .ok_or_else(CoreError::not_found)
        })
        .transpose()?;
    let search = crate::lexical::casefold(q.search.as_deref().unwrap_or("").trim());
    let page_size = if search.is_empty() {
        PAGE_SIZE
    } else {
        SEARCH_PAGE_SIZE
    };
    let mut records: Vec<(usize, Option<usize>)> = if let Some(f) = focus {
        world.incident[f]
            .iter()
            .filter_map(|&j| {
                let e = &edges[j];
                let a = e[0].as_u64().unwrap() as usize;
                let b = e[1].as_u64().unwrap() as usize;
                if (q.direction.as_deref() == Some("in") && b != f)
                    || (q.direction.as_deref() == Some("out") && a != f)
                    || q.kind
                        .as_deref()
                        .is_some_and(|k| k != "all" && Some(k) != e[2].as_str())
                {
                    return None;
                }
                let other = if a == f { b } else { a };
                if target.is_some_and(|t| t != other) {
                    return None;
                }
                Some((other, Some(j)))
            })
            .collect()
    } else {
        (0..nodes.len()).map(|i| (i, None)).collect()
    };
    records.retain(|&(i, _)| search.is_empty() || world.folded[i].1.contains(&search));
    records.sort_by(|(a, ae), (b, be)| {
        let at = &world.folded[*a].0;
        let bt = &world.folded[*b].0;
        (at != &search, at, *a, *ae).cmp(&(bt != &search, bt, *b, *be))
    });
    let mut v = envelope(data, visibility, world);
    v["total"] = json!(records.len());
    let offset = q.offset.unwrap_or(0);
    if offset > 0 && offset >= records.len() {
        return Err(invalid());
    }
    v["offset"] = json!(offset);
    v["page_size"] = json!(page_size);
    v["items"]=json!(records.iter().skip(offset).take(page_size).map(|&(i,e)|{
        let link=e.map(|j|{let e=&edges[j];json!({"from":data["nodes"][e[0].as_u64().unwrap()as usize]["id"],"to":data["nodes"][e[1].as_u64().unwrap()as usize]["id"],"kind":e[2],"weight":e[3]})});json!({"node":meta(data,world,i),"link":link})
    }).collect::<Vec<_>>());
    v["selected"] = focus.map(|f| meta(data, world, f)).unwrap_or(Value::Null);
    v["focus_bounds"] = focus
        .map(|f| {
            let mut members = BTreeSet::from([f]);
            if let Some(t) = target {
                members.insert(t);
            }
            for &j in &world.incident[f] {
                if target.is_some() {
                    break;
                }
                let e = &edges[j];
                members.insert(e[0].as_u64().unwrap() as usize);
                members.insert(e[1].as_u64().unwrap() as usize);
            }
            json!(Bounds::from_points(
                members.iter().map(|&i| world.points[i])
            ))
        })
        .unwrap_or(Value::Null);
    Ok(v)
}
fn bounded(value: Value) -> Result<Json<Value>, CoreError> {
    if serde_json::to_vec(&value)
        .map_err(|_| CoreError::database())?
        .len()
        > MAX_BYTES
    {
        return Err(CoreError {
            code: "SCENE_CAPACITY_EXCEEDED",
            message: "Spatial response exceeds its byte budget; refine the view",
            status: StatusCode::UNPROCESSABLE_ENTITY,
        });
    }
    Ok(Json(value))
}
pub fn routes() -> Router<StateData> {
    Router::new()
        .route("/v1/domains/{domain}/graph/scene", get(read_scene))
        .route("/v1/domains/{domain}/graph/map/nodes", get(read_nodes))
}
async fn read_scene(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    Query(q): Query<Request>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    read(s, domain, q, headers, false).await
}
async fn read_nodes(
    State(s): State<StateData>,
    Path(domain): Path<String>,
    Query(q): Query<Request>,
    headers: HeaderMap,
) -> Result<Json<Value>, CoreError> {
    read(s, domain, q, headers, true).await
}
async fn read(
    s: StateData,
    domain: String,
    q: Request,
    headers: HeaderMap,
    list: bool,
) -> Result<Json<Value>, CoreError> {
    q.validate()?;
    let p = s.auth.authenticate(&headers)?;
    let domain = Uuid::parse_str(&domain)
        .map_err(|_| CoreError::invalid_uuid())?
        .to_string();
    let graph = s.graph.as_ref().ok_or_else(CoreError::database)?;
    // Serialize scene preparation/assembly per tenant and domain, not authentication.
    // No parallel copies of one cold topology; other domains proceed independently
    // and cancelled waiters hold no DB lock.
    let lease = graph.scene_locks.lease(&p.tenant, &domain);
    let _turn = lease.turn().await;
    p.check_fresh()?;
    let version = graph.ensure_read_projection(&p, &domain).await?;
    if q.at_version.is_some_and(|v| v != version) {
        return Err(changed());
    }
    let mut tx = graph
        .read_projection_transaction(&p, &domain, version)
        .await?;
    // Authorization is always freshly checked and locked, even on cache hits.
    // Sources/projections are immutable except audited source ACL transitions.
    // Hash actual current rights, not just an event counter or a cached role.
    let revision: String = sqlx::query_scalar(include_str!("sql/graph_scene_revision.sql"))
        .bind(&p.tenant)
        .bind(&domain)
        .bind(&p.subject)
        .fetch_one(&mut *tx)
        .await
        .map_err(CoreError::sql)?;
    let bytes = graph_map::documentary_bytes()?;
    let overlay = format!("{:x}", Sha256::digest(bytes.as_deref().unwrap_or_default()));
    let layout = q.layout.as_deref().unwrap_or("territories");
    let key = cache_key(&p.tenant, &domain, &p.subject, &revision, &overlay, layout);
    let cached = graph
        .scene_cache
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&key, Instant::now());
    let result = if let Some(prepared) = cached {
        prepared.response(&q, list)?
    } else {
        let data = graph_map::load(&mut tx, &p, &domain, version, bytes.as_deref()).await?;
        let encoded = serde_json::to_vec(&data).map_err(|_| CoreError::database())?;
        let mut hash = Sha256::new();
        hash.update(p.tenant.as_bytes());
        hash.update(p.subject.as_bytes());
        hash.update(encoded);
        let visibility = format!("{:x}", hash.finalize());
        let world = place(&data, layout);
        let prepared = Prepared {
            data,
            world,
            visibility,
        };
        let result = prepared.response(&q, list)?;
        graph
            .scene_cache
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key, prepared, Instant::now());
        result
    };
    let output = bounded(result)?;
    p.check_fresh()?;
    tx.commit().await.map_err(CoreError::sql)?;
    p.check_fresh()?;
    Ok(output)
}
// Only authorized metadata and derived coordinates live here, never bodies,
// source text or tokens. This is process-local and cannot outlive its DB service.
const CACHE_BUDGET: usize = 128 * 1024 * 1024;
const CACHE_ENTRIES: usize = 8;
const CACHE_TTL: Duration = Duration::from_secs(300);
struct Prepared {
    data: Value,
    world: World,
    visibility: String,
}
impl Prepared {
    fn response(&self, q: &Request, list: bool) -> Result<Value, CoreError> {
        if q.visibility.as_ref().is_some_and(|v| v != &self.visibility) {
            return Err(changed());
        }
        if let Some(target) = &q.target {
            if !self.world.by_id.contains_key(target)
                || q.focus
                    .as_ref()
                    .is_none_or(|f| !self.world.by_id.contains_key(f))
            {
                return Err(CoreError::not_found());
            }
        }
        if list {
            listing(&self.data, &self.world, q, &self.visibility)
        } else {
            Ok(scene(&self.data, &self.world, q, &self.visibility))
        }
    }
    fn charge(&self) -> usize {
        // Conservative retained-allocation accounting; not a measured RSS budget.
        fn value(v: &Value) -> usize {
            std::mem::size_of::<Value>()
                + match v {
                    Value::String(s) => s.capacity(),
                    Value::Array(a) => a.iter().map(value).sum::<usize>() + a.capacity() * 32,
                    Value::Object(m) => m.iter().map(|(k, v)| k.capacity() + 128 + value(v)).sum(),
                    _ => 32,
                }
        }
        value(&self.data)
            + self.world.points.capacity() * 16
            + self.world.degree.capacity() * 8
            + self.world.incident.capacity() * 24
            + self
                .world
                .incident
                .iter()
                .map(|v| v.capacity() * 8)
                .sum::<usize>()
            + self
                .world
                .by_id
                .iter()
                .map(|(k, _)| k.capacity() + 96)
                .sum::<usize>()
            + self
                .world
                .folded
                .iter()
                .map(|(a, b)| a.capacity() + b.capacity() + 48)
                .sum::<usize>()
            + self.visibility.capacity()
            + 512
    }
}
struct CacheEntry {
    key: String,
    value: Arc<Prepared>,
    charge: usize,
    used: Instant,
}
#[derive(Default)]
pub(crate) struct SceneCache {
    entries: VecDeque<CacheEntry>,
    charged: usize,
}
impl SceneCache {
    fn get(&mut self, key: &str, now: Instant) -> Option<Arc<Prepared>> {
        self.entries
            .retain(|e| now.saturating_duration_since(e.used) < CACHE_TTL);
        self.charged = self.entries.iter().map(|e| e.charge).sum();
        let i = self.entries.iter().position(|e| e.key == key)?;
        let mut entry = self.entries.remove(i).unwrap();
        entry.used = now;
        self.entries.push_back(entry);
        Some(self.entries.back().unwrap().value.clone())
    }
    fn insert(&mut self, key: String, value: Prepared, now: Instant) {
        let charge = value.charge();
        if !self.make_room(charge) {
            return;
        }
        self.charged += charge;
        self.entries.push_back(CacheEntry {
            key,
            value: Arc::new(value),
            charge,
            used: now,
        });
    }
    fn make_room(&mut self, charge: usize) -> bool {
        if charge > CACHE_BUDGET {
            return false;
        }
        while !self.entries.is_empty()
            && (self.entries.len() >= CACHE_ENTRIES || self.charged + charge > CACHE_BUDGET)
        {
            self.charged -= self.entries.pop_front().unwrap().charge;
        }
        true
    }
}
/// One turn per (tenant, domain) currently running or waiting.
type SceneTurns = HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>;
/// Serializes scene preparation per tenant and domain, so one cold topology is
/// never built twice in parallel while other domains proceed independently.
#[derive(Default)]
pub(crate) struct SceneLocks {
    turns: Mutex<SceneTurns>,
}
impl SceneLocks {
    fn lease(&self, tenant: &str, domain: &str) -> SceneLease<'_> {
        let key = (tenant.to_owned(), domain.to_owned());
        let turn = self
            .turns
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key.clone())
            .or_default()
            .clone();
        SceneLease {
            locks: self,
            key,
            turn,
        }
    }
}
/// One request's claim on a domain turn. Dropping it, even while still waiting,
/// forgets the slot once no other request runs or waits on that domain.
struct SceneLease<'a> {
    locks: &'a SceneLocks,
    key: (String, String),
    turn: Arc<tokio::sync::Mutex<()>>,
}
impl SceneLease<'_> {
    async fn turn(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.turn.lock().await
    }
}
impl Drop for SceneLease<'_> {
    fn drop(&mut self) {
        let mut turns = self
            .locks
            .turns
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let unused = turns
            .get(&self.key)
            .is_some_and(|t| Arc::ptr_eq(t, &self.turn) && Arc::strong_count(t) == 2);
        if unused {
            turns.remove(&self.key);
        }
    }
}
fn cache_key(
    tenant: &str,
    domain: &str,
    subject: &str,
    revision: &str,
    overlay: &str,
    layout: &str,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(tenant, domain, subject, revision, overlay, layout))
                .expect("string tuple")
        )
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(n: usize) -> Value {
        json!({"domain_id":Uuid::nil(),"at_version":2,"nodes":(0..n).map(|i|json!({"id":Uuid::from_u128(i as u128+1),"title":format!("Concept {i:05}"),"maturity":"emerging","group":"Group","territory":"Region"})).collect::<Vec<_>>(),"edges":(0..n).map(|i|json!([i,(i+1)%n,"associative",0.5])).collect::<Vec<_>>(),"published_relations":n,"documentary_references":0})
    }
    fn prepared(n: usize) -> Prepared {
        let data = fixture(n);
        let world = place(&data, "territories");
        Prepared {
            data,
            world,
            visibility: "authorized".into(),
        }
    }
    #[test]
    fn target_pair_is_exact_bounded_and_prioritized_in_a_dense_scene() {
        let mut data = fixture(1000);
        data["edges"] = json!(
            (1..1000)
                .map(|i| json!([0, i, "associative", 0.7]))
                .chain([json!([999, 0, "structural", 0.3])])
                .collect::<Vec<_>>()
        );
        let q = Request {
            focus: Some(Uuid::from_u128(1).to_string()),
            target: Some(Uuid::from_u128(1000).to_string()),
            ..Default::default()
        };
        assert!(q.validate().is_ok());
        for layout in ["territories", "fireworks", "circle", "lines"] {
            let world = place(&data, layout);
            let page = listing(&data, &world, &q, "v").unwrap();
            assert_eq!(page["total"], 2);
            assert_eq!(page["items"][0]["node"]["id"], json!(Uuid::from_u128(1000)));
            let out = scene(&data, &world, &q, "v");
            assert!(out["glyphs"].as_array().unwrap().len() <= 24);
            assert!(out["links"].as_array().unwrap().len() <= 120);
            let endpoints: Vec<_> = out["glyphs"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
                .filter(|(_, g)| {
                    g["concept_id"] == json!(Uuid::from_u128(1))
                        || g["concept_id"] == json!(Uuid::from_u128(1000))
                })
                .map(|(i, _)| i)
                .collect();
            assert_eq!(endpoints.len(), 2);
            assert_eq!(
                out["links"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|e| e["aggregate"] == false
                        && endpoints.contains(&(e["from"].as_u64().unwrap() as usize))
                        && endpoints.contains(&(e["to"].as_u64().unwrap() as usize)))
                    .count(),
                2
            );
            assert!(bounded(out).is_ok());
            let page = listing(
                &data,
                &world,
                &Request {
                    direction: Some("out".into()),
                    kind: Some("associative".into()),
                    focus: q.focus.clone(),
                    target: q.target.clone(),
                    ..Default::default()
                },
                "v",
            )
            .unwrap();
            assert_eq!(page["total"], 1);
            assert_eq!(page["items"][0]["link"]["weight"], 0.7);
        }
    }
    #[test]
    fn missing_pair_and_stale_visibility_are_refused_without_recreating_an_old_link() {
        let mut p = prepared(4);
        p.data["edges"] = json!([]);
        p.world = place(&p.data, "territories");
        let mut q = Request {
            focus: Some(Uuid::from_u128(1).to_string()),
            target: Some(Uuid::from_u128(4).to_string()),
            ..Default::default()
        };
        let page = p.response(&q, true).unwrap();
        assert_eq!(page["total"], 0);
        assert!(page["selected"].is_object());
        assert!(page["focus_bounds"].is_object());
        assert_eq!(p.response(&q, false).unwrap()["links"], json!([]));
        q.target = Some(Uuid::from_u128(5).to_string());
        for list in [true, false] {
            assert_eq!(
                p.response(&q, list).unwrap_err().status,
                StatusCode::NOT_FOUND
            );
        }
        q.visibility = Some("stale".into());
        assert_eq!(
            p.response(&q, true).unwrap_err().status,
            StatusCode::CONFLICT
        );
        assert!(
            Request {
                target: Some(Uuid::nil().to_string()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            Request {
                focus: q.focus,
                target: Some("invalid".into()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn cache_separates_scope_revision_overlay_and_layout() {
        let initial = [
            "tenant",
            "domain",
            "subject",
            "rights-and-projection",
            "overlay",
            "territories",
        ];
        let key = |a: [&str; 6]| cache_key(a[0], a[1], a[2], a[3], a[4], a[5]);
        let mut c = SceneCache::default();
        let now = Instant::now();
        c.insert(key(initial), prepared(3), now);
        for i in 0..6 {
            let mut other = initial;
            other[i] = "different";
            assert!(c.get(&key(other), now).is_none());
        }
        let p = c.get(&key(initial), now).unwrap();
        assert!(
            p.response(
                &Request {
                    visibility: Some("stale".into()),
                    ..Default::default()
                },
                false
            )
            .is_err()
        );
        assert_eq!(
            p.response(&Request::default(), false).unwrap()["totals"]["concepts"],
            3
        );
    }
    #[tokio::test]
    async fn scene_turns_serialize_one_domain_without_blocking_others() {
        use tokio::time::timeout;
        let wait = Duration::from_millis(50);
        let locks = SceneLocks::default();
        let first = locks.lease("tenant", "a");
        let held = first.turn().await;
        let other_domain = locks.lease("tenant", "b");
        let other_tenant = locks.lease("other", "a");
        assert!(timeout(wait, other_domain.turn()).await.is_ok());
        assert!(timeout(wait, other_tenant.turn()).await.is_ok());
        let same = locks.lease("tenant", "a");
        assert!(timeout(wait, same.turn()).await.is_err());
        drop(held);
        assert!(timeout(wait, same.turn()).await.is_ok());
    }
    #[tokio::test]
    async fn scene_turn_slots_are_forgotten_once_unused_even_after_cancelled_waits() {
        use tokio::time::timeout;
        let locks = SceneLocks::default();
        {
            let first = locks.lease("tenant", "a");
            let _held = first.turn().await;
            let waiter = locks.lease("tenant", "a");
            assert!(
                timeout(Duration::from_millis(20), waiter.turn())
                    .await
                    .is_err()
            );
            assert_eq!(locks.turns.lock().unwrap().len(), 1);
        }
        assert!(locks.turns.lock().unwrap().is_empty());
        let again = locks.lease("tenant", "a");
        drop(again.turn().await);
        drop(again);
        assert!(locks.turns.lock().unwrap().is_empty());
    }
    #[test]
    fn cache_evicts_by_recency_budget_and_idle_expiry() {
        let mut c = SceneCache::default();
        let now = Instant::now();
        for i in 0..CACHE_ENTRIES {
            c.insert(i.to_string(), prepared(3), now);
        }
        c.get("0", now).unwrap();
        c.insert("new".into(), prepared(3), now);
        assert!(c.get("1", now).is_none());
        assert!(c.get("0", now).is_some());
        assert_eq!(c.entries.len(), CACHE_ENTRIES);
        assert!(c.charged <= CACHE_BUDGET);
        assert!(!c.make_room(CACHE_BUDGET + 1));
        assert_eq!(c.entries.len(), CACHE_ENTRIES);
        assert!(c.make_room(CACHE_BUDGET));
        assert_eq!(c.charged, 0);
        c.insert("expiry".into(), prepared(2), now);
        assert!(c.get("expiry", now + CACHE_TTL).is_none());
        assert_eq!(c.charged, 0);
    }
    #[test]
    fn selected_neighbors_are_landmarks_before_unrelated_high_degree_nodes() {
        let mut data = fixture(1000);
        data["edges"] = json!(
            (0..1000)
                .map(|i| json!([i, if i == 999 { 998 } else { 0 }, "associative", 0.5]))
                .collect::<Vec<_>>()
        );
        let world = place(&data, "territories");
        let out = scene(
            &data,
            &world,
            &Request {
                focus: Some(Uuid::from_u128(1000).to_string()),
                ..Default::default()
            },
            "v",
        );
        for id in [999, 1000] {
            assert!(
                out["glyphs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|g| g["concept_id"] == json!(Uuid::from_u128(id)))
            );
        }
    }
    #[test]
    fn ten_thousand_are_aggregated_before_transport_and_all_ids_are_searchable() {
        let data = fixture(10_000);
        let world = place(&data, "territories");
        let out = scene(&data, &world, &Request::default(), "v");
        assert!(out["glyphs"].as_array().unwrap().len() <= 24);
        assert!(out["links"].as_array().unwrap().len() <= MAX_LINKS);
        assert!(bounded(out).is_ok());
        let q = Request {
            search: Some("Concept 09999".into()),
            ..Default::default()
        };
        let page = listing(&data, &world, &q, "v").unwrap();
        assert_eq!(page["total"], 1);
        assert_eq!(
            page["items"][0]["node"]["id"],
            json!(Uuid::from_u128(10000))
        );
        assert_eq!(page["totals"]["concepts"], 10000);
    }
    #[test]
    fn search_pages_are_complete_with_the_server_normalized_bound() {
        let data = fixture(35);
        let world = place(&data, "lines");
        let mut seen = BTreeSet::new();
        for offset in [0, 8, 16, 24, 32] {
            let page = listing(
                &data,
                &world,
                &Request {
                    search: Some("\u{2003}CONCEPT\u{a0}".into()),
                    offset: Some(offset),
                    ..Default::default()
                },
                "v",
            )
            .unwrap();
            assert_eq!(page["page_size"], 8);
            assert_eq!(page["total"], 35);
            assert!(page["items"].as_array().unwrap().len() <= 8);
            for item in page["items"].as_array().unwrap() {
                assert!(seen.insert(item["node"]["id"].as_str().unwrap().to_owned()));
            }
        }
        assert_eq!(seen.len(), 35);
        let empty = listing(
            &data,
            &world,
            &Request {
                search: Some("\u{2003}\u{a0}".into()),
                ..Default::default()
            },
            "v",
        )
        .unwrap();
        assert_eq!(empty["page_size"], 16);
        assert_eq!(empty["items"].as_array().unwrap().len(), 16);
    }
    #[test]
    fn all_layouts_respect_total_glyph_bound_across_zoom_levels() {
        let data = fixture(10_000);
        for layout in ["territories", "fireworks", "circle", "lines"] {
            let world = place(&data, layout);
            for size in [100.0, 1000.0, 10_000.0, 100_000.0] {
                let out = scene(
                    &data,
                    &world,
                    &Request {
                        x: Some(-size / 2.0),
                        y: Some(-size / 2.0),
                        w: Some(size),
                        h: Some(size),
                        ..Default::default()
                    },
                    "v",
                );
                assert!(
                    out["glyphs"].as_array().unwrap().len() <= 24,
                    "{layout} {size}"
                );
                assert!(out["links"].as_array().unwrap().len() <= 120);
                assert!(bounded(out).is_ok());
            }
        }
    }
    #[test]
    fn unicode_search_keeps_native_casefold_semantics() {
        let mut data = fixture(2);
        data["nodes"][0]["title"] = json!("Straße");
        let w = place(&data, "lines");
        let page = listing(
            &data,
            &w,
            &Request {
                search: Some("STRASSE".into()),
                ..Default::default()
            },
            "v",
        )
        .unwrap();
        assert_eq!(page["total"], 1);
        assert_eq!(page["items"][0]["node"]["title"], "Straße");
    }
    #[test]
    fn panning_does_not_change_cell_membership_or_centroids() {
        let data = fixture(10000);
        let world = place(&data, "fireworks");
        let q = Request {
            x: Some(-2000.0),
            y: Some(-2500.0),
            w: Some(2000.0),
            h: Some(2000.0),
            ..Default::default()
        };
        let a = scene(&data, &world, &q, "v");
        let b = scene(
            &data,
            &world,
            &Request {
                x: Some(-1800.0),
                ..q
            },
            "v",
        );
        assert_eq!(a["cell_size"], b["cell_size"]);
        let mut matched = 0;
        for n in a["glyphs"].as_array().unwrap() {
            if n["concept_id"].is_null() {
                if let Some(other) = b["glyphs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|m| m["id"] == n["id"])
                {
                    assert_eq!(n, other);
                    matched += 1;
                }
            }
        }
        assert!(matched > 0);
    }
    #[test]
    fn neighbor_paging_is_complete_and_keeps_direction_and_type() {
        let mut data = fixture(51);
        data["edges"] = json!(
            (1..51)
                .map(|i| json!([
                    0,
                    i,
                    if i % 2 == 0 {
                        "reference"
                    } else {
                        "associative"
                    },
                    if i % 2 == 0 { Value::Null } else { json!(0.5) }
                ]))
                .collect::<Vec<_>>()
        );
        let w = place(&data, "lines");
        let mut seen = BTreeSet::new();
        for offset in [0, 16, 32, 48] {
            let q = Request {
                focus: Some(Uuid::from_u128(1).to_string()),
                offset: Some(offset),
                ..Default::default()
            };
            let p = listing(&data, &w, &q, "v").unwrap();
            assert_eq!(p["total"], 50);
            for n in p["items"].as_array().unwrap() {
                assert!(seen.insert(n["node"]["id"].as_str().unwrap().to_owned()));
                assert_eq!(n["link"]["from"], json!(Uuid::from_u128(1)));
            }
        }
        assert_eq!(seen.len(), 50);
        let q = Request {
            focus: Some(Uuid::from_u128(1).to_string()),
            direction: Some("in".into()),
            ..Default::default()
        };
        assert_eq!(listing(&data, &w, &q, "v").unwrap()["total"], 0);
    }
    #[test]
    fn unknown_focus_and_unfenced_or_nonfinite_queries_are_rejected() {
        for raw in [
            json!({"x":0}),
            json!({"x":0,"y":0,"w":0,"h":2}),
            json!({"offset":16}),
            json!({"layout":"unknown"}),
            json!({"visibility":"bad"}),
            json!({"focus":"secret"}),
        ] {
            assert!(
                serde_json::from_value::<Request>(raw)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        let data = fixture(1);
        let w = place(&data, "lines");
        assert!(
            listing(
                &data,
                &w,
                &Request {
                    focus: Some(Uuid::nil().to_string()),
                    ..Default::default()
                },
                "v"
            )
            .is_err()
        );
    }
    #[test]
    fn empty_map_and_all_layouts_have_finite_bounded_geometry() {
        for layout in ["territories", "fireworks", "circle", "lines"] {
            for n in [0, 1, 1000] {
                let data = fixture(n);
                let w = place(&data, layout);
                assert!(w.points.iter().all(|p| p.x.is_finite() && p.y.is_finite()));
                assert!(bounded(scene(&data, &w, &Request::default(), "v")).is_ok());
            }
        }
    }
}
