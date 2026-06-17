import { useState, useEffect, useRef, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, Polyline, ZoomControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geoNaturalEarth1, geoPath, geoInterpolate, geoGraticule10 } from 'd3-geo'
import { feature } from 'topojson-client'
import worldTopo from 'world-atlas/countries-110m.json'
import restaurantsData from './restaurants.json'
const DATA = restaurantsData.restaurants.map(r => ({
  id: r.id,
  name: r.name,
  addr: r.address,
  cuisine: r.cuisineType,
  origin: r.cuisineOrigin,
  codes: (r.originCountries || []).map(c => c.code),
  lat: r.lat,
  lng: r.lng,
  rating: r.rating,
  price: r.price,
  dish: r.recommendedDish,
  summary: r.summary,
  starter: r.starterReview,
}))

// ── Country lookup ────────────────────────────────────────────────────────────
const CC = {
  IN:{name:'India',lat:20.5937,lng:78.9629},
  TR:{name:'Turkey',lat:38.9637,lng:35.2433},
  GB:{name:'United Kingdom',lat:55.3781,lng:-3.436},
  US:{name:'United States',lat:37.0902,lng:-95.7129},
  MX:{name:'Mexico',lat:23.6345,lng:-102.5528},
  IR:{name:'Iran',lat:32.4279,lng:53.688},
  PT:{name:'Portugal',lat:39.3999,lng:-8.2245},
  ZA:{name:'South Africa',lat:-30.5595,lng:22.9375},
  IT:{name:'Italy',lat:41.8719,lng:12.5674},
  AL:{name:'Albania',lat:41.1533,lng:20.1683},
  GR:{name:'Greece',lat:39.0742,lng:21.8243},
  VN:{name:'Vietnam',lat:14.0583,lng:108.2772},
  TW:{name:'Taiwan',lat:23.6978,lng:120.9605},
}

const STORE = 'tolworth_reviews_v2'

function fmt(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (isNaN(dt)) return d
  return dt.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
}

// ── Real geographic map geometry ──────────────────────────────────────────────
// Restaurants ordered west→east (along the street) so the spine traces the road.
const STREET_ORDER = [...DATA].sort((a, b) => a.lng - b.lng)
const STREET_LATLNGS = STREET_ORDER.map(r => [r.lat, r.lng])

// Some outlets share a building / exact coordinates (e.g. Taqueria + Rose, or the
// two chicken shops at no. 54). Fan those colliding pins out by a few metres so each
// is visible and clickable. The street spine still uses the true coordinates above.
const MARKER_POS = (() => {
  const EARTH = 6378137, rad = d => d * Math.PI / 180
  const metres = (a, b) => {
    const dLat = (b.lat - a.lat) * Math.PI / 180 * EARTH
    const dLng = (b.lng - a.lng) * Math.PI / 180 * EARTH * Math.cos(rad(a.lat))
    return Math.hypot(dLat, dLng)
  }
  // Cluster outlets that sit within 5m of each other.
  const groups = []
  STREET_ORDER.forEach(r => {
    const g = groups.find(g => metres(g[0], r) < 5)
    if (g) g.push(r); else groups.push([r])
  })
  const pos = {}
  const spread = 9 // metres from the cluster centre
  groups.forEach(g => {
    if (g.length === 1) { pos[g[0].id] = [g[0].lat, g[0].lng]; return }
    const cLat = g.reduce((s, r) => s + r.lat, 0) / g.length
    const cLng = g.reduce((s, r) => s + r.lng, 0) / g.length
    g.forEach((r, i) => {
      const ang = -Math.PI / 4 + (i / g.length) * 2 * Math.PI
      const dLat = (spread * Math.sin(ang)) / EARTH * 180 / Math.PI
      const dLng = (spread * Math.cos(ang)) / (EARTH * Math.cos(rad(cLat))) * 180 / Math.PI
      pos[r.id] = [cLat + dLat, cLng + dLng]
    })
  })
  return pos
})()
// Bounding box of every outlet, used to frame the map.
const MAP_BOUNDS = (() => {
  const lats = DATA.map(r => r.lat), lngs = DATA.map(r => r.lng)
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]]
})()
const MAP_CENTER = [
  (MAP_BOUNDS[0][0] + MAP_BOUNDS[1][0]) / 2,
  (MAP_BOUNDS[0][1] + MAP_BOUNDS[1][1]) / 2,
]

// CARTO dark basemap — free, no API key, matches the void aesthetic.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

// Brand-styled glowing pin built per marker state.
function markerIcon({ rating, selected, hovered, inFilter }) {
  const base = 13 + (rating - 3.5) * 5
  const d = Math.round((selected || hovered) ? base * 1.4 : base)
  const bg = selected ? '#ffb829' : (inFilter ? '#8052ff' : '#3a3a3a')
  const glow = inFilter
    ? (selected ? '0 0 16px 2px rgba(255,184,41,0.75)' : '0 0 12px 1px rgba(128,82,255,0.65)')
    : 'none'
  const op = inFilter ? 1 : 0.4
  const border = selected ? '1.5px solid #ffd27a' : '1px solid rgba(0,0,0,0.45)'
  return L.divIcon({
    className: 'tb-marker',
    iconSize: [d, d],
    iconAnchor: [d / 2, d / 2],
    html: `<div style="width:${d}px;height:${d}px;border-radius:50%;background:${bg};box-shadow:${glow};border:${border};opacity:${op};transition:all .15s ease;"></div>`,
  })
}

// Frame the viewport to the outlets once the map mounts.
function FitBounds({ bounds }) {
  const map = useMap()
  useEffect(() => { map.fitBounds(bounds, { padding: [50, 50] }) }, [map, bounds])
  return null
}

function LocalMap({ markers, onOpenDetail, onSetHover }) {
  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={17}
      maxZoom={20}
      scrollWheelZoom={true}
      zoomControl={false}
      attributionControl={true}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: '#000' }}
    >
      <ZoomControl position="topright" />
      <FitBounds bounds={MAP_BOUNDS} />
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} detectRetina={true} maxZoom={20} maxNativeZoom={20} />
      <Polyline
        positions={STREET_LATLNGS}
        pathOptions={{ color: '#8052ff', weight: 2, opacity: 0.55 }}
        className="tb-spine"
      />
      {markers.map(m => (
        <Marker
          key={m.id}
          position={MARKER_POS[m.id]}
          icon={markerIcon(m)}
          zIndexOffset={m.sel || m.hov ? 1000 : 0}
          eventHandlers={{
            click: () => onOpenDetail(m.id),
            mouseover: () => onSetHover(m.id),
            mouseout: () => onSetHover(null),
          }}
        >
          <Tooltip direction="top" offset={[0, -6]} permanent={m.sel} className="tb-tip">{m.name}</Tooltip>
        </Marker>
      ))}
    </MapContainer>
  )
}

// ── World map (real country outlines, Natural Earth projection) ───────────────
// ISO 3166 numeric ids (matching world-atlas) for each origin country.
const ISO_NUM = { IN:356, TR:792, GB:826, US:840, MX:484, IR:364, PT:620, ZA:710, IT:380, AL:8, GR:300, VN:704, TW:158 }
const ORIGIN_NUMS = new Set(Object.values(ISO_NUM))

const WORLD_W = 1000, WORLD_H = 520
const WORLD_FEATURES = feature(worldTopo, worldTopo.objects.countries).features
const WORLD_PROJ = geoNaturalEarth1().fitExtent([[12, 12], [WORLD_W - 12, WORLD_H - 12]], { type: 'Sphere' })
const WORLD_PATH = geoPath(WORLD_PROJ)
// Precompute every country's SVG path + whether it's an origin.
const COUNTRY_PATHS = WORLD_FEATURES.map(f => ({
  id: f.id,
  d: WORLD_PATH(f),
  origin: ORIGIN_NUMS.has(Number(f.id)),
}))
const GRATICULE_PATH = WORLD_PATH(geoGraticule10())
const SPHERE_PATH = WORLD_PATH({ type: 'Sphere' })

// Project a [lng,lat] to SVG space.
const projectPt = (lng, lat) => WORLD_PROJ([lng, lat])

// Build the origin nodes + great-circle connection arcs from the GB hub.
function buildWorld(counts) {
  const nodes = Object.keys(counts).map(code => {
    const [x, y] = projectPt(CC[code].lng, CC[code].lat)
    return { code, name: CC[code].name, count: counts[code], x, y, r: 5 + counts[code] * 1.7 }
  })
  const hub = nodes.find(n => n.code === 'GB')
  const arcs = nodes.filter(n => n.code !== 'GB').map(n => {
    const interp = geoInterpolate([CC.GB.lng, CC.GB.lat], [CC[n.code].lng, CC[n.code].lat])
    const pts = Array.from({ length: 24 }, (_, i) => projectPt(...interp(i / 23)))
    return { code: n.code, d: 'M' + pts.map(p => p.join(',')).join('L') }
  })
  return { nodes, hub, arcs }
}

// ── Particle hero ─────────────────────────────────────────────────────────────
function useHero(canvasRef) {
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return
    const ctx = cv.getContext('2d')
    const COLORS = ['#8052ff','#8052ff','#8052ff','#8052ff','#ffb829','#15846e','#ffffff','#ffffff']
    const SHAPES = ['circle','circle','circle','diamond','triangle','square']
    const st = { w:0, h:0, parts:[], mouse:{x:-9999,y:-9999} }
    const gauss = () => (Math.random()+Math.random()+Math.random()-1.5)/1.5
    let raf

    function seed() {
      const W=st.w, H=st.h; st.parts=[]
      const N = Math.round(W*H/1500)
      const cx=W*0.62, cy=H*0.42
      for (let i=0;i<N;i++) {
        let x,y,inC; const roll=Math.random()
        if (roll<0.6) { x=cx+gauss()*W*0.22; y=cy+gauss()*H*0.30; inC=true }
        else { x=Math.random()*W; y=Math.random()*H; inC=false }
        const sz = inC ? (1.4+Math.random()*3.2) : (1+Math.random()*1.6)
        st.parts.push({ x,y,hx:x,hy:y, vx:(Math.random()-0.5)*0.15, vy:(Math.random()-0.5)*0.15, size:sz,
          color: inC ? COLORS[(Math.random()*COLORS.length)|0] : (Math.random()<0.5?'#ffffff':'#9a9a9a'),
          shape: SHAPES[(Math.random()*SHAPES.length)|0],
          baseA: inC ? (0.5+Math.random()*0.45) : (0.16+Math.random()*0.28),
          tw: Math.random()*Math.PI*2, tws: 0.6+Math.random()*1.5, rot:Math.random()*Math.PI, rs:(Math.random()-0.5)*0.01 })
      }
    }

    function resize() {
      const r=cv.getBoundingClientRect(); const dpr=Math.min(window.devicePixelRatio||1,2)
      st.w=r.width; st.h=r.height
      cv.width=Math.max(1,Math.round(r.width*dpr)); cv.height=Math.max(1,Math.round(r.height*dpr))
      ctx.setTransform(dpr,0,0,dpr,0,0); seed()
    }

    function draw() {
      const {w,h,parts}=st; ctx.clearRect(0,0,w,h)
      for (const p of parts) {
        p.x+=p.vx; p.y+=p.vy; p.hx+=p.vx*0.04; p.hy+=p.vy*0.04
        p.x+=(p.hx-p.x)*0.012; p.y+=(p.hy-p.y)*0.012
        const dx=p.x-st.mouse.x, dy=p.y-st.mouse.y, d2=dx*dx+dy*dy
        if (d2<12000) { const d=Math.sqrt(d2)||1; const f=(1-d/110)*2.2; p.x+=dx/d*f; p.y+=dy/d*f }
        if (p.x<-10) p.x=w+10; if (p.x>w+10) p.x=-10; if (p.y<-10) p.y=h+10; if (p.y>h+10) p.y=-10
        p.rot+=p.rs; p.tw+=0.016*p.tws
        ctx.globalAlpha=Math.max(0,p.baseA*(0.6+0.4*Math.sin(p.tw))); ctx.fillStyle=p.color; const s=p.size
        if (p.shape==='circle') { ctx.beginPath(); ctx.arc(p.x,p.y,s*0.6,0,Math.PI*2); ctx.fill() }
        else if (p.shape==='square') { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.fillRect(-s*.5,-s*.5,s,s); ctx.restore() }
        else if (p.shape==='diamond') { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot+Math.PI/4); ctx.fillRect(-s*.5,-s*.5,s,s); ctx.restore() }
        else { ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot); ctx.beginPath(); ctx.moveTo(0,-s*.8); ctx.lineTo(s*.7,s*.6); ctx.lineTo(-s*.7,s*.6); ctx.closePath(); ctx.fill(); ctx.restore() }
      }
      ctx.globalAlpha=1; raf=requestAnimationFrame(draw)
    }

    const onMove = e => { const r=cv.getBoundingClientRect(); st.mouse.x=e.clientX-r.left; st.mouse.y=e.clientY-r.top }
    const onLeave = () => { st.mouse.x=-9999; st.mouse.y=-9999 }
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerleave', onLeave)

    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize(); raf=requestAnimationFrame(draw)

    return () => { cancelAnimationFrame(raf); ro.disconnect(); cv.removeEventListener('pointermove',onMove); cv.removeEventListener('pointerleave',onLeave) }
  }, [canvasRef])
}

// ── Shared style helpers ──────────────────────────────────────────────────────
const inputBase = { background:'#0b0b0b', borderRadius:24, padding:'14px 18px', color:'#fff', fontSize:14, letterSpacing:'0.02em', outline:'none', width:'100%' }

// ── Components ────────────────────────────────────────────────────────────────

function Logo({ size=30, fontSize=11, gap=12, wordmarkSize=15 }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap}}>
      <div style={{width:size,height:size,border:'1.5px solid #8052ff',borderRadius:Math.round(size*0.267),display:'flex',alignItems:'center',justifyContent:'center',transform:'rotate(45deg)'}}>
        <span style={{transform:'rotate(-45deg)',fontWeight:700,fontSize,color:'#fff',letterSpacing:'0.02em'}}>TB</span>
      </div>
      <span style={{fontWeight:600,fontSize:wordmarkSize,letterSpacing:'0.01em',color:'#fff'}}>Tolworth Broadway</span>
    </div>
  )
}

function Pill({ children, onClick, href, outlined, style: extra={} }) {
  const base = {
    fontWeight:600,fontSize:12,letterSpacing:'0.05em',textTransform:'uppercase',
    color:'#fff',padding:'11px 18px',borderRadius:24,cursor:'pointer',whiteSpace:'nowrap',
    textDecoration:'none',display:'inline-block',transition:'background .15s,border-color .15s',
    ...(outlined ? {background:'transparent',border:'1px solid rgba(255,255,255,0.25)'} : {background:'#8052ff',border:'none'}),
    ...extra,
  }
  if (href) return <a href={href} style={base}
    onMouseEnter={e=>{e.currentTarget.style.background=outlined?'transparent':'#9168ff';if(outlined)e.currentTarget.style.borderColor='#fff'}}
    onMouseLeave={e=>{e.currentTarget.style.background=outlined?'transparent':'#8052ff';if(outlined)e.currentTarget.style.borderColor='rgba(255,255,255,0.25)'}}
  >{children}</a>
  return <button onClick={onClick} style={{...base,fontFamily:'inherit'}}
    onMouseEnter={e=>e.currentTarget.style.background=outlined?'rgba(255,255,255,0.05)':'#9168ff'}
    onMouseLeave={e=>e.currentTarget.style.background=outlined?'transparent':'#8052ff'}
  >{children}</button>
}

function Nav({ onAddReview }) {
  return (
    <nav style={{position:'sticky',top:0,zIndex:50,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'18px 40px',background:'rgba(0,0,0,0.55)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)',borderBottom:'1px solid rgba(255,255,255,0.08)'}}>
      <a href="#top" style={{textDecoration:'none'}}><Logo /></a>
      <div style={{display:'flex',alignItems:'center',gap:30}}>
        {['Local map','World map','Restaurants'].map((label,i)=>(
          <a key={i} href={['#map','#world','#directory'][i]}
            style={{fontWeight:400,fontSize:14,letterSpacing:'0.02em',color:'#9a9a9a',textDecoration:'none',transition:'color .15s'}}
            onMouseEnter={e=>e.currentTarget.style.color='#fff'}
            onMouseLeave={e=>e.currentTarget.style.color='#9a9a9a'}
          >{label}</a>
        ))}
        <Pill onClick={onAddReview}>Add a review</Pill>
      </div>
    </nav>
  )
}

function Hero({ savedReviews }) {
  const cvRef = useRef(null)
  useHero(cvRef)
  const countries = useMemo(()=>Object.keys(DATA.reduce((m,r)=>{r.codes.forEach(c=>{m[c]=1});return m},{})).length,[])

  return (
    <section id="top" style={{position:'relative',background:'#000',overflow:'hidden'}}>
      <canvas ref={cvRef} style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block'}} />
      <div style={{position:'relative',zIndex:5,maxWidth:1200,margin:'0 auto',padding:'0 40px',height:'82vh',minHeight:600}}>
        <div style={{position:'absolute',top:60,right:40,textAlign:'right'}}>
          {[[''+DATA.length,'Food outlets','#fff'],[''+countries,'Origin countries','#fff'],[''+savedReviews,'Saved reviews','#8052ff']].map(([val,label,col],i)=>(
            <div key={i} style={{padding:'16px 0',borderBottom:i<2?'1px solid rgba(255,255,255,0.12)':'none'}}>
              <div style={{fontWeight:200,fontSize:46,letterSpacing:'-0.03em',color:col,lineHeight:1}}>{val}</div>
              <div style={{fontWeight:400,fontSize:11,letterSpacing:'0.07em',textTransform:'uppercase',color:'#9a9a9a',marginTop:4}}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{position:'absolute',left:40,bottom:52,maxWidth:780}}>
          <div style={{fontWeight:600,fontSize:12,letterSpacing:'0.16em',textTransform:'uppercase',color:'#8052ff',marginBottom:20}}>{DATA.length} outlets · one stretch · KT6</div>
          <h1 style={{margin:0,fontWeight:200,fontSize:'clamp(48px,8vw,94px)',lineHeight:0.86,letterSpacing:'-0.045em',color:'#fff'}}>Eat your way<br/>down the Broadway.</h1>
          <p style={{fontWeight:400,fontSize:16,lineHeight:1.55,letterSpacing:'0.02em',color:'#bdbdbd',margin:'26px 0 0',maxWidth:440}}>Restaurants, origins, reviews and photos from one stretch of Tolworth — mapped marker by marker into a living local food guide.</p>
          <div style={{display:'flex',alignItems:'center',gap:14,marginTop:30}}>
            <Pill href="#map" style={{padding:'14px 22px'}}>Explore the map</Pill>
            <Pill href="#reviews" outlined style={{padding:'13px 22px'}}>Read reviews</Pill>
          </div>
        </div>
      </div>
    </section>
  )
}

function MapSection({ q, cuisine, sort, selectedId, hoverId, reviews, onOpenDetail, onSetQ, onSetCuisine, onSetSort, onSetHover, onAddReview }) {
  const [foc, setFoc] = useState({})
  const sf = k => ({ onFocus:()=>setFoc(f=>({...f,[k]:true})), onBlur:()=>setFoc(f=>({...f,[k]:false})) })

  const cuisines = useMemo(()=>[...new Set(DATA.map(r=>r.cuisine))].sort(),[])

  // One enriched, filtered + sorted card per restaurant: general info + its latest review.
  const cards = useMemo(()=>{
    const qt = q.trim().toLowerCase()
    const list = DATA.filter(r=>{
      if (cuisine!=='all' && r.cuisine!==cuisine) return false
      if (!qt) return true
      return (r.name+' '+r.cuisine+' '+r.origin+' '+r.addr+' '+r.dish).toLowerCase().includes(qt)
    }).map(r=>{
      const ur = reviews.filter(v=>v.restaurantId===r.id).sort((a,b)=>b.createdAt-a.createdAt)
      const latest = ur[0] || null
      return { r, rc: ur.length, latest, ts: latest?latest.createdAt:0 }
    })
    if (sort==='rating') list.sort((a,b)=>b.r.rating-a.r.rating||a.r.name.localeCompare(b.r.name))
    else if (sort==='newest') list.sort((a,b)=>(b.ts-a.ts)||a.r.name.localeCompare(b.r.name))
    else list.sort((a,b)=>a.r.name.localeCompare(b.r.name))
    return list
  },[q,cuisine,sort,reviews])

  const filteredIds = useMemo(()=>new Set(cards.map(c=>c.r.id)),[cards])

  const mapMarkers = STREET_ORDER.map(r=>{
    const sel=selectedId===r.id, hov=hoverId===r.id, inF=filteredIds.has(r.id)
    return { id:r.id, name:r.name, lat:r.lat, lng:r.lng, rating:r.rating, sel, hov, inFilter:inF }
  })

  const reset = () => { onSetQ(''); onSetCuisine('all') }
  const selectChrome = key => ({background:'#0b0b0b',border:`1px solid ${foc[key]?'#8052ff':'rgba(255,255,255,0.14)'}`,borderRadius:24,padding:'14px 18px',color:'#fff',fontSize:14,letterSpacing:'0.02em',outline:'none',cursor:'pointer',appearance:'none',WebkitAppearance:'none'})

  return (
    <section id="map" style={{scrollMarginTop:84,maxWidth:1200,margin:'0 auto',padding:'90px 40px 0'}}>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:24,flexWrap:'wrap'}}>
        <div>
          <div style={{fontWeight:600,fontSize:12,letterSpacing:'0.16em',textTransform:'uppercase',color:'#8052ff',marginBottom:18}}>Local guide</div>
          <h2 style={{margin:0,fontWeight:200,fontSize:'clamp(34px,5vw,58px)',lineHeight:1,letterSpacing:'-0.035em',color:'#fff',maxWidth:760}}>Explore every restaurant on Tolworth Broadway.</h2>
        </div>
        <Pill onClick={onAddReview}>Add a review</Pill>
      </div>
      <p style={{fontWeight:400,fontSize:16,lineHeight:1.55,letterSpacing:'0.02em',color:'#9a9a9a',margin:'22px 0 0',maxWidth:600}}>Every outlet, its origin, and its latest review in one place. Pick a marker or a card to read more and add your own write-up. Markers glow brighter the higher they rate — dim ones fall outside your current filter.</p>

      <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',marginTop:38}}>
        <div style={{position:'relative',flex:1,minWidth:240}}>
          <span style={{position:'absolute',left:18,top:'50%',transform:'translateY(-50%)',color:'#6a6a6a',fontSize:15,pointerEvents:'none'}}>⌕</span>
          <input type="text" value={q} onChange={e=>onSetQ(e.target.value)} placeholder="Search restaurants, cuisines, origins…"
            style={{...inputBase,border:`1px solid ${foc.q?'#8052ff':'rgba(255,255,255,0.14)'}`,paddingLeft:40}}
            {...sf('q')} />
        </div>
        <select value={cuisine} onChange={e=>onSetCuisine(e.target.value)} style={{...selectChrome('c'),minWidth:190}} {...sf('c')}>
          <option value="all">All cuisines</option>
          {cuisines.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={e=>onSetSort(e.target.value)} style={{...selectChrome('s'),minWidth:170}} {...sf('s')}>
          <option value="name">Sort · Name</option>
          <option value="rating">Sort · Rating</option>
          <option value="newest">Sort · Newest review</option>
        </select>
        <button onClick={reset} title="Reset filters"
          style={{background:'transparent',border:'1px solid rgba(255,255,255,0.14)',borderRadius:24,width:48,height:48,color:'#9a9a9a',fontSize:17,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',transition:'border-color .15s,color .15s',flexShrink:0}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='#fff';e.currentTarget.style.color='#fff'}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.14)';e.currentTarget.style.color='#9a9a9a'}}
        >↺</button>
      </div>
      <div style={{fontWeight:400,fontSize:13,letterSpacing:'0.04em',color:'#6a6a6a',marginTop:16}}>
        Showing <span style={{color:'#fff'}}>{cards.length}</span> of {DATA.length} outlets
      </div>

      <div style={{position:'relative',width:'100%',height:440,border:'1px solid rgba(255,255,255,0.10)',borderRadius:24,overflow:'hidden',marginTop:24,isolation:'isolate',zIndex:0}}>
        <LocalMap markers={mapMarkers} onOpenDetail={onOpenDetail} onSetHover={onSetHover} />
        <div style={{position:'absolute',left:24,top:18,fontWeight:600,fontSize:11,letterSpacing:'0.14em',textTransform:'uppercase',color:'#cfcfcf',zIndex:1200,pointerEvents:'none',textShadow:'0 1px 6px rgba(0,0,0,0.9)'}}>Tolworth Broadway · A240</div>
        <div style={{position:'absolute',left:24,bottom:16,fontWeight:400,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',zIndex:1200,pointerEvents:'none',textShadow:'0 1px 6px rgba(0,0,0,0.9)'}}>← KT6 7DQ</div>
        <div style={{position:'absolute',right:24,bottom:16,fontWeight:400,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',zIndex:1200,pointerEvents:'none',textShadow:'0 1px 6px rgba(0,0,0,0.9)'}}>KT6 7HT →</div>
      </div>

      {cards.length > 0 ? (
        <div id="directory" style={{scrollMarginTop:84,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:18,marginTop:24}}>
          {cards.map(({r,rc,latest})=>(
            <div key={r.id} onClick={()=>onOpenDetail(r.id)}
              style={{background:'#0a0a0a',border:'1px solid rgba(255,255,255,0.10)',borderRadius:24,overflow:'hidden',cursor:'pointer',transition:'border-color .2s,background .2s',display:'flex',flexDirection:'column'}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(128,82,255,0.6)';e.currentTarget.style.background='#0c0a14'}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.10)';e.currentTarget.style.background='#0a0a0a'}}>
              {latest?.photo && <img src={latest.photo} alt="" style={{width:'100%',height:170,objectFit:'cover',display:'block',borderBottom:'1px solid rgba(255,255,255,0.08)'}}/>}
              <div style={{padding:24,display:'flex',flexDirection:'column',gap:14,flex:1}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                  <span style={{fontWeight:600,fontSize:11,letterSpacing:'0.04em',textTransform:'uppercase',color:'#8052ff',border:'1px solid rgba(128,82,255,0.45)',borderRadius:24,padding:'5px 11px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:200}}>{r.cuisine}</span>
                  <span style={{fontWeight:500,fontSize:13,color:'#ffb829',whiteSpace:'nowrap'}}>★ {r.rating.toFixed(1)}</span>
                </div>
                <div>
                  <div style={{fontWeight:200,fontSize:27,lineHeight:1.05,letterSpacing:'-0.02em',color:'#fff'}}>{r.name}</div>
                  <div style={{fontWeight:400,fontSize:12,letterSpacing:'0.05em',textTransform:'uppercase',color:'#9a9a9a',marginTop:7}}>{r.origin}</div>
                </div>
                <p style={{margin:0,fontWeight:400,fontSize:14,lineHeight:1.5,letterSpacing:'0.01em',color:'#bdbdbd'}}>{r.summary}</p>

                <div style={{marginTop:'auto',display:'flex',flexDirection:'column',gap:12,paddingTop:14,borderTop:'1px solid rgba(255,255,255,0.07)'}}>
                  {latest ? (
                    <div>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:6}}>
                        <span style={{fontWeight:500,fontSize:12,letterSpacing:'0.03em',color:'#8052ff'}}>{latest.name}</span>
                        <span style={{fontWeight:500,fontSize:12,color:'#ffb829',whiteSpace:'nowrap'}}>★ {Number(latest.rating).toFixed(1)}</span>
                      </div>
                      <p style={{margin:0,fontWeight:400,fontSize:13.5,lineHeight:1.5,color:'#cfcfcf',display:'-webkit-box',WebkitLineClamp:3,WebkitBoxOrient:'vertical',overflow:'hidden'}}>“{latest.text}”</p>
                    </div>
                  ) : (
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#6a6a6a'}}>Starter note</span>
                      <span style={{fontWeight:400,fontSize:12,color:'#6a6a6a'}}>· no reviews yet</span>
                    </div>
                  )}
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                    <span style={{fontWeight:400,fontSize:12,letterSpacing:'0.03em',color:'#6a6a6a'}}>{r.price} · {r.addr.split(',')[0]}</span>
                    <span style={{fontWeight:500,fontSize:11,letterSpacing:'0.06em',textTransform:'uppercase',color:rc===0?'#6a6a6a':'#8052ff'}}>{rc===0?'Add a review':`${rc} review${rc>1?'s':''}`} →</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{textAlign:'center',padding:'50px 0',color:'#6a6a6a',fontSize:15,letterSpacing:'0.02em'}}>
          No outlets match that filter.{' '}
          <span onClick={reset} style={{color:'#8052ff',cursor:'pointer',textDecoration:'underline'}}>Reset</span>
        </div>
      )}
    </section>
  )
}

function WorldSection({ onSetQ }) {
  const counts = useMemo(()=>{ const m={}; DATA.forEach(r=>r.codes.forEach(c=>{m[c]=(m[c]||0)+1})); return m },[])
  const { nodes, hub, arcs } = useMemo(()=>buildWorld(counts),[counts])
  const legend = useMemo(()=>[...nodes].sort((a,b)=>b.count-a.count),[nodes])
  const [hover, setHover] = useState(null)

  const onPick = name => { onSetQ(name); document.getElementById('map')?.scrollIntoView({ behavior:'smooth' }) }

  return (
    <section id="world" style={{scrollMarginTop:84,maxWidth:1200,margin:'0 auto',padding:'110px 40px 0'}}>
      <div style={{fontWeight:600,fontSize:12,letterSpacing:'0.16em',textTransform:'uppercase',color:'#8052ff',marginBottom:18}}>World map</div>
      <h2 style={{margin:0,fontWeight:200,fontSize:'clamp(34px,5vw,58px)',lineHeight:1,letterSpacing:'-0.035em',color:'#fff',maxWidth:760}}>See where the food comes from.</h2>
      <p style={{fontWeight:400,fontSize:16,lineHeight:1.55,letterSpacing:'0.02em',color:'#9a9a9a',margin:'22px 0 0',maxWidth:600}}>Each origin node is scaled by how many Tolworth restaurants connect to that country. Arcs radiate from the Broadway. Fusion kitchens connect to more than one place. Tap a node to filter the directory.</p>

      <div style={{position:'relative',width:'100%',background:'radial-gradient(ellipse 80% 80% at 50% 45%, #0a0a14 0%, #000 72%)',border:'1px solid rgba(255,255,255,0.10)',borderRadius:24,overflow:'hidden',marginTop:38}}>
        <svg viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} preserveAspectRatio="xMidYMid meet" style={{display:'block',width:'100%',height:'auto'}}>
          {/* sphere + graticule */}
          <path d={SPHERE_PATH} fill="#05050a" stroke="rgba(255,255,255,0.06)" strokeWidth="0.6"/>
          <path d={GRATICULE_PATH} fill="none" stroke="#ffffff" strokeOpacity="0.045" strokeWidth="0.5"/>
          {/* country outlines */}
          {COUNTRY_PATHS.map((c,i)=>(
            <path key={i} d={c.d}
              fill={c.origin ? 'rgba(128,82,255,0.16)' : 'rgba(255,255,255,0.025)'}
              stroke={c.origin ? 'rgba(128,82,255,0.55)' : 'rgba(255,255,255,0.10)'}
              strokeWidth={c.origin ? 0.7 : 0.4}/>
          ))}
          {/* connection arcs from the GB hub */}
          <g style={{filter:'drop-shadow(0 0 4px rgba(128,82,255,0.5))'}}>
            {arcs.map(a=>(
              <path key={a.code} d={a.d} fill="none" stroke="#8052ff"
                strokeOpacity={hover && hover!==a.code ? 0.18 : 0.5} strokeWidth="1"/>
            ))}
          </g>
          {/* nodes */}
          {nodes.map(n=>{
            const isHub = n.code==='GB', hot = hover===n.code
            return (
              <g key={n.code} transform={`translate(${n.x},${n.y})`} style={{cursor:'pointer'}}
                onMouseEnter={()=>setHover(n.code)} onMouseLeave={()=>setHover(null)}
                onClick={()=>onPick(n.name)}>
                <circle r={n.r * (hot?1.25:1)}
                  fill={isHub ? '#ffb829' : '#8052ff'}
                  stroke={isHub ? '#ffd27a' : 'rgba(255,255,255,0.25)'}
                  strokeWidth={isHub ? 1 : 0.5}
                  style={{filter:`drop-shadow(0 0 ${isHub?10:7}px ${isHub?'rgba(255,184,41,0.75)':'rgba(128,82,255,0.7)'})`,transition:'all .15s'}}/>
              </g>
            )
          })}
          {/* hub caption */}
          <text x={hub.x} y={hub.y - hub.r - 7} textAnchor="middle"
            fill="#ffb829" fontSize="11" fontWeight="600" letterSpacing="1.2"
            style={{textTransform:'uppercase'}}>◆ TOLWORTH</text>
          {/* hover label */}
          {hover && (() => {
            const n = nodes.find(x=>x.code===hover); if(!n||n.code==='GB') return null
            const label = `${n.name}  ×${n.count}`
            const w = label.length * 6.7 + 16
            const above = n.y > 60
            const ly = above ? n.y - n.r - 10 : n.y + n.r + 22
            return (
              <g pointerEvents="none">
                <rect x={n.x - w/2} y={ly - 14} width={w} height={20} rx={10}
                  fill="#000" stroke="rgba(255,255,255,0.16)" strokeWidth="0.6"/>
                <text x={n.x} y={ly} textAnchor="middle" fontSize="11.5" fontWeight="500">
                  <tspan fill="#fff">{n.name}</tspan><tspan fill="#8052ff" dx="5" fontWeight="600">×{n.count}</tspan>
                </text>
              </g>
            )
          })()}
        </svg>
      </div>

      <div style={{display:'flex',flexWrap:'wrap',gap:10,marginTop:22}}>
        {legend.map(l=>(
          <div key={l.code} onMouseEnter={()=>setHover(l.code)} onMouseLeave={()=>setHover(null)}
            onClick={()=>onPick(l.name)}
            style={{display:'flex',alignItems:'center',gap:9,border:`1px solid ${hover===l.code?'rgba(128,82,255,0.6)':'rgba(255,255,255,0.12)'}`,borderRadius:24,padding:'8px 14px',cursor:'pointer',transition:'border-color .15s'}}>
            <span style={{width:8,height:8,borderRadius:'50%',background:l.code==='GB'?'#ffb829':'#8052ff',display:'inline-block'}}/>
            <span style={{fontWeight:400,fontSize:13,letterSpacing:'0.02em',color:'#bdbdbd'}}>{l.name}</span>
            <span style={{fontWeight:600,fontSize:13,color:'#fff'}}>{l.count}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function DetailModal({ id, reviews, onClose, onWriteReview }) {
  const r = DATA.find(x=>x.id===id); if (!r) return null
  const rviews = reviews.filter(v=>v.restaurantId===id).sort((a,b)=>b.createdAt-a.createdAt)
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:80,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(6px)',WebkitBackdropFilter:'blur(6px)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'60px 20px',overflow:'auto'}}>
      <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:620,background:'#070707',border:'1px solid rgba(255,255,255,0.14)',borderRadius:24,overflow:'hidden',animation:'tbfade .25s ease'}}>
        <div style={{position:'relative',height:180,background:'repeating-linear-gradient(135deg,#0d0d0d 0,#0d0d0d 11px,#101010 11px,#101010 22px)',borderBottom:'1px solid rgba(255,255,255,0.08)',display:'flex',alignItems:'center',justifyContent:'center'}}>
          <span style={{fontFamily:'ui-monospace,monospace',fontSize:12,letterSpacing:'0.08em',color:'#4a4a4a'}}>[ storefront photo — {r.name} ]</span>
          <button onClick={onClose} style={{position:'absolute',top:16,right:16,width:34,height:34,borderRadius:'50%',background:'rgba(0,0,0,0.6)',border:'1px solid rgba(255,255,255,0.18)',color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#fff'} onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.18)'}>×</button>
        </div>
        <div style={{padding:'28px 30px 30px'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
            <span style={{fontWeight:600,fontSize:11,letterSpacing:'0.05em',textTransform:'uppercase',color:'#8052ff',border:'1px solid rgba(128,82,255,0.45)',borderRadius:24,padding:'5px 12px'}}>{r.cuisine}</span>
            <span style={{fontWeight:500,fontSize:15,color:'#ffb829'}}>★ {r.rating.toFixed(1)}</span>
          </div>
          <h3 style={{margin:'18px 0 0',fontWeight:200,fontSize:42,lineHeight:0.95,letterSpacing:'-0.03em',color:'#fff'}}>{r.name}</h3>
          <div style={{display:'flex',flexWrap:'wrap',gap:18,marginTop:16}}>
            {[['Origin',r.origin],['Address',r.addr],['Price',r.price]].map(([label,val])=>(
              <div key={label}>
                <div style={{fontWeight:400,fontSize:10,letterSpacing:'0.08em',textTransform:'uppercase',color:'#6a6a6a'}}>{label}</div>
                <div style={{fontWeight:400,fontSize:14,color:'#bdbdbd',marginTop:3}}>{val}</div>
              </div>
            ))}
          </div>
          <p style={{fontWeight:400,fontSize:15,lineHeight:1.6,letterSpacing:'0.02em',color:'#e6e6e6',margin:'22px 0 0'}}>{r.summary}</p>
          <div style={{marginTop:14,fontWeight:400,fontSize:13,letterSpacing:'0.02em',color:'#9a9a9a'}}>Recommended · <span style={{color:'#fff'}}>{r.dish}</span></div>
          <div style={{marginTop:26,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontWeight:600,fontSize:12,letterSpacing:'0.1em',textTransform:'uppercase',color:'#fff'}}>Reviews</div>
            <Pill onClick={onWriteReview} style={{padding:'9px 15px',fontSize:11}}>Write a review</Pill>
          </div>
          {rviews.length > 0 ? (
            <div style={{marginTop:16,display:'flex',flexDirection:'column',gap:12}}>
              {rviews.map(v=>(
                <div key={v.id} style={{border:'1px solid rgba(255,255,255,0.10)',borderRadius:18,padding:16}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                    <span style={{fontWeight:500,fontSize:13,color:'#fff'}}>{v.name}</span>
                    <span style={{fontWeight:500,fontSize:13,color:'#ffb829'}}>★ {Number(v.rating).toFixed(1)}</span>
                  </div>
                  {v.photo && <img src={v.photo} alt="" style={{width:'100%',height:160,objectFit:'cover',borderRadius:12,marginTop:12,display:'block'}}/>}
                  <p style={{margin:'10px 0 0',fontWeight:400,fontSize:14,lineHeight:1.55,color:'#cfcfcf'}}>{v.text}</p>
                  <div style={{marginTop:10,fontWeight:400,fontSize:12,color:'#6a6a6a'}}>{v.dish?v.dish+' · ':''}{fmt(v.date)||fmt(new Date(v.createdAt))}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{marginTop:16,border:'1px dashed rgba(255,255,255,0.14)',borderRadius:18,padding:18}}>
              <div style={{fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#6a6a6a',marginBottom:8}}>Starter note</div>
              <p style={{margin:0,fontWeight:400,fontSize:14,lineHeight:1.55,color:'#bdbdbd'}}>{r.starter}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewFormModal({ presetId, onClose, onSave }) {
  const [form, setForm] = useState({restaurantId:presetId||'',name:'',date:'',rating:4,dish:'',text:'',photo:null})
  const patch = p => setForm(f=>({...f,...p}))
  const [foc, setFoc] = useState({})
  const sf = k => ({onFocus:()=>setFoc(f=>({...f,[k]:true})),onBlur:()=>setFoc(f=>({...f,[k]:false}))})
  const fb = k => `1px solid ${foc[k]?'#8052ff':'rgba(255,255,255,0.14)'}`
  const onPhoto = e => { const f=e.target.files?.[0]; if(!f)return; const rd=new FileReader(); rd.onload=()=>patch({photo:rd.result}); rd.readAsDataURL(f) }
  const sortedR = useMemo(()=>[...DATA].sort((a,b)=>a.name.localeCompare(b.name)),[])
  const fixedName = presetId ? DATA.find(r=>r.id===presetId)?.name : ''

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:90,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(6px)',WebkitBackdropFilter:'blur(6px)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'50px 20px',overflow:'auto'}}>
      <div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:520,background:'#070707',border:'1px solid rgba(255,255,255,0.14)',borderRadius:24,padding:30,animation:'tbfade .25s ease'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:24}}>
          <div style={{fontWeight:200,fontSize:30,letterSpacing:'-0.02em',color:'#fff'}}>Add a review</div>
          <button onClick={onClose} style={{width:34,height:34,borderRadius:'50%',background:'transparent',border:'1px solid rgba(255,255,255,0.18)',color:'#fff',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='#fff'} onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.18)'}>×</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          {presetId ? (
            <div style={{background:'#0c0a14',border:'1px solid rgba(128,82,255,0.4)',borderRadius:14,padding:'13px 16px',fontWeight:500,fontSize:14,color:'#fff'}}>{fixedName}</div>
          ) : (
            <label style={{display:'block'}}>
              <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Restaurant</span>
              <select value={form.restaurantId} onChange={e=>patch({restaurantId:e.target.value})}
                style={{width:'100%',background:'#0b0b0b',border:fb('rs'),borderRadius:14,padding:'13px 14px',color:form.restaurantId?'#fff':'#6a6a6a',fontSize:14,outline:'none',cursor:'pointer',appearance:'none',WebkitAppearance:'none'}} {...sf('rs')}>
                <option value="">Choose a restaurant…</option>
                {sortedR.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
          <div style={{display:'flex',gap:12}}>
            <label style={{flex:1}}>
              <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Your name</span>
              <input type="text" value={form.name} onChange={e=>patch({name:e.target.value})} placeholder="Local guide"
                style={{width:'100%',background:'#0b0b0b',border:fb('nm'),borderRadius:14,padding:'13px 14px',color:'#fff',fontSize:14,outline:'none'}} {...sf('nm')}/>
            </label>
            <label style={{flex:1}}>
              <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Visit date</span>
              <input type="date" value={form.date} onChange={e=>patch({date:e.target.value})}
                style={{width:'100%',background:'#0b0b0b',border:fb('dt'),borderRadius:14,padding:'13px 14px',color:'#fff',fontSize:14,outline:'none',colorScheme:'dark'}} {...sf('dt')}/>
            </label>
          </div>
          <div>
            <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Rating · {form.rating}.0</span>
            <div style={{display:'flex',gap:8}}>
              {[1,2,3,4,5].map(n=>(
                <button key={n} onClick={()=>patch({rating:n})}
                  style={{background:'transparent',border:'none',cursor:'pointer',fontSize:30,lineHeight:1,color:form.rating>=n?'#ffb829':'rgba(255,255,255,0.22)',padding:0,transition:'transform .12s'}}
                  onMouseEnter={e=>e.currentTarget.style.transform='scale(1.15)'} onMouseLeave={e=>e.currentTarget.style.transform=''}>★</button>
              ))}
            </div>
          </div>
          <label style={{display:'block'}}>
            <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Recommended dish</span>
            <input type="text" value={form.dish} onChange={e=>patch({dish:e.target.value})} placeholder="What should people order?"
              style={{width:'100%',background:'#0b0b0b',border:fb('dsh'),borderRadius:14,padding:'13px 14px',color:'#fff',fontSize:14,outline:'none'}} {...sf('dsh')}/>
          </label>
          <label style={{display:'block'}}>
            <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Review</span>
            <textarea value={form.text} onChange={e=>patch({text:e.target.value})} placeholder="What was it like? Value, service, the signature order…" rows={4}
              style={{width:'100%',background:'#0b0b0b',border:fb('tx'),borderRadius:14,padding:'13px 14px',color:'#fff',fontSize:14,lineHeight:1.5,outline:'none',resize:'vertical'}} {...sf('tx')}/>
          </label>
          <div>
            <span style={{display:'block',fontWeight:500,fontSize:11,letterSpacing:'0.08em',textTransform:'uppercase',color:'#9a9a9a',marginBottom:8}}>Photo</span>
            <div style={{display:'flex',alignItems:'center',gap:14}}>
              <label style={{display:'inline-flex',alignItems:'center',gap:8,border:'1px solid rgba(255,255,255,0.16)',borderRadius:14,padding:'11px 16px',cursor:'pointer',color:'#bdbdbd',fontSize:13,letterSpacing:'0.02em',transition:'border-color .15s,color .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='#fff';e.currentTarget.style.color='#fff'}} onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.16)';e.currentTarget.style.color='#bdbdbd'}}>
                <span>＋ Upload photo</span>
                <input type="file" accept="image/*" onChange={onPhoto} style={{display:'none'}}/>
              </label>
              {form.photo && <img src={form.photo} alt="" style={{width:54,height:54,objectFit:'cover',borderRadius:12,border:'1px solid rgba(255,255,255,0.15)'}}/>}
            </div>
          </div>
          <button onClick={()=>onSave(form)}
            style={{marginTop:8,fontWeight:600,fontSize:13,letterSpacing:'0.05em',textTransform:'uppercase',color:'#fff',background:'#8052ff',padding:16,borderRadius:24,border:'none',cursor:'pointer',width:'100%',transition:'background .15s'}}
            onMouseEnter={e=>e.currentTarget.style.background='#9168ff'} onMouseLeave={e=>e.currentTarget.style.background='#8052ff'}>Save review</button>
          <div style={{textAlign:'center',fontWeight:400,fontSize:12,color:'#6a6a6a',letterSpacing:'0.02em'}}>Saved in this browser only.</div>
        </div>
      </div>
    </div>
  )
}

function Toast({ message }) {
  return (
    <div style={{position:'fixed',bottom:30,left:'50%',transform:'translateX(-50%)',zIndex:120,background:'#8052ff',color:'#fff',fontWeight:500,fontSize:13,letterSpacing:'0.03em',padding:'14px 24px',borderRadius:24,animation:'tbfade .25s ease',pointerEvents:'none',whiteSpace:'nowrap'}}>
      {message}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [reviews, setReviews] = useState(()=>{
    try { const raw=localStorage.getItem(STORE); return raw?JSON.parse(raw):[] } catch { return [] }
  })
  const [q, setQ] = useState('')
  const [cuisine, setCuisine] = useState('all')
  const [sort, setSort] = useState('name')
  const [selectedId, setSelectedId] = useState(null)
  const [hoverId, setHoverId] = useState(null)
  const [modal, setModal] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  const showToast = msg => { setToast(msg); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(()=>setToast(null),2600) }
  const openDetail = id => { setModal('detail'); setActiveId(id); setSelectedId(id) }
  const openForm = id => { setModal('form'); setActiveId(id||null) }
  const closeModal = () => setModal(null)

  const saveReview = form => {
    if (!form.restaurantId) { showToast('Pick a restaurant first'); return }
    if (!form.name.trim() || !form.text.trim()) { showToast('Add your name and a few words'); return }
    const rev = { id:'r'+Date.now(), restaurantId:form.restaurantId, name:form.name.trim(), date:form.date,
      rating:Number(form.rating)||4, dish:form.dish.trim(), text:form.text.trim(), photo:form.photo, createdAt:Date.now() }
    const updated = [rev, ...reviews]
    try { localStorage.setItem(STORE, JSON.stringify(updated)) } catch {}
    setReviews(updated); setModal(null); setSelectedId(form.restaurantId)
    showToast('Review saved to this browser')
  }

  const handleWorldNodeClick = name => { setQ(name); setCuisine('all') }

  return (
    <div style={{background:'#000',minHeight:'100vh'}}>
      <Nav onAddReview={()=>openForm(null)} />
      <Hero savedReviews={reviews.length} />
      <MapSection q={q} cuisine={cuisine} sort={sort} selectedId={selectedId} hoverId={hoverId} reviews={reviews}
        onOpenDetail={openDetail} onSetQ={setQ} onSetCuisine={setCuisine} onSetSort={setSort} onSetHover={setHoverId}
        onAddReview={()=>openForm(null)} />
      <WorldSection onSetQ={handleWorldNodeClick} />

      <footer style={{maxWidth:1200,margin:'110px auto 0',padding:'48px 40px 60px',borderTop:'1px solid rgba(255,255,255,0.08)',display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:30,flexWrap:'wrap'}}>
        <div>
          <div style={{marginBottom:14}}><Logo size={26} fontSize={10} gap={12} wordmarkSize={14}/></div>
          <p style={{margin:0,fontWeight:400,fontSize:13,lineHeight:1.6,letterSpacing:'0.02em',color:'#6a6a6a',maxWidth:420}}>
            Built from <span style={{color:'#9a9a9a',fontFamily:'ui-monospace,monospace',fontSize:12}}>Tolworth_Broadway_Food_Outlets.xlsx</span>. Review submissions are saved in this browser.
          </p>
        </div>
        <div style={{fontWeight:400,fontSize:12,letterSpacing:'0.05em',textTransform:'uppercase',color:'#5a5a5a'}}>Tolworth · KT6</div>
      </footer>

      {modal==='detail' && activeId && <DetailModal id={activeId} reviews={reviews} onClose={closeModal} onWriteReview={()=>openForm(activeId)}/>}
      {modal==='form' && <ReviewFormModal presetId={activeId} onClose={closeModal} onSave={saveReview}/>}
      {toast && <Toast message={toast}/>}
    </div>
  )
}
