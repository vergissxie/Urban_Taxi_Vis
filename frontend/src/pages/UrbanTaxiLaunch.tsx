import React from 'react';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  CarFront,
  Clock3,
  Crosshair,
  Database,
  Gauge,
  Grid3X3,
  Layers3,
  MapPinned,
  Network,
  RadioTower,
  Route,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import '../styles/launch.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface ProductFeature {
  code: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const consoleHref = '#/console';

const productFeatures: ProductFeature[] = [
  {
    code: 'F1-F2',
    title: '轨迹溯源与回放',
    description: '按车辆、时间和行程追踪出租车运行过程，对比原始轨迹与路网匹配结果。',
    icon: Route,
  },
  {
    code: 'F3-F4',
    title: '区域统计与网格热力',
    description: '框选北京重点区域，使用 H3 网格聚合识别供需热点、异常密度与空间分布。',
    icon: Grid3X3,
  },
  {
    code: 'F5-F6',
    title: 'OD 流向与辐射诊断',
    description: '分析区域之间的流入、流出、净流量和核心区辐射关系，辅助交通治理判断。',
    icon: RadioTower,
  },
  {
    code: 'F7-F9',
    title: '高频路径与策略推荐',
    description: '挖掘高频通行走廊、A/B 候选路径和调度策略，为运营决策提供依据。',
    icon: Sparkles,
  },
];

const valueCards = [
  {
    label: '从轨迹到决策',
    value: 'F1-F9',
    text: '覆盖数据检索、空间聚合、OD 诊断和路线推荐，不停留在单张热力图。',
  },
  {
    label: '北京城市语境',
    value: 'BJ',
    text: '围绕城市路网、区域供需和出租车运行规律组织分析入口。',
  },
  {
    label: '可解释交互',
    value: 'Live',
    text: '每个结论都能回到地图、时间轴和候选路径，而不是只给静态指标。',
  },
];

export default function UrbanTaxiLaunch() {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const mm = gsap.matchMedia();
    mm.add(
      {
        reduceMotion: '(prefers-reduced-motion: reduce)',
        isDesktop: '(min-width: 900px)',
      },
      (context) => {
        const conditions = context.conditions as { reduceMotion?: boolean; isDesktop?: boolean };
        const reduceMotion = Boolean(conditions.reduceMotion);
        const isDesktop = Boolean(conditions.isDesktop);

        gsap.set('.launch-animated', { autoAlpha: 1 });
        if (reduceMotion) {
          gsap.set('.launch-reveal, .city-layer, .product-section, .feature-card, .value-card, .workflow-step', {
            autoAlpha: 1,
            clearProps: 'transform',
          });
          return undefined;
        }

        const intro = gsap.timeline({ defaults: { duration: 0.72, ease: 'power3.out' } });
        intro
          .from('.launch-nav', { y: -18, autoAlpha: 0, duration: 0.5 })
          .from('.launch-reveal', { y: 34, autoAlpha: 0, stagger: 0.08 }, '-=0.12')
          .from('.city-layer', { y: 28, autoAlpha: 0, stagger: 0.08 }, '-=0.42');

        gsap.to('.route-flow', {
          strokeDashoffset: -280,
          duration: 3.8,
          repeat: -1,
          ease: 'none',
          stagger: 0.18,
        });

        gsap.to('.taxi-dot', {
          x: (index) => [92, -76, 64, -54][index % 4],
          y: (index) => [-28, 34, -18, 24][index % 4],
          duration: (index) => [4.7, 5.4, 4.2, 5.9][index % 4],
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
          stagger: 0.12,
        });

        gsap.to('.scan-beam', {
          xPercent: 118,
          duration: 3.4,
          repeat: -1,
          ease: 'none',
        });

        gsap.fromTo(
          '.metric-bar-fill',
          { scaleX: 0.16 },
          { scaleX: 1, transformOrigin: 'left center', duration: 1.15, ease: 'power3.out', stagger: 0.1 },
        );

        gsap.utils.toArray<HTMLElement>('.product-section').forEach((section) => {
          gsap.from(section.querySelectorAll('.section-reveal'), {
            scrollTrigger: {
              trigger: section,
              start: 'top 78%',
              once: true,
            },
            y: 36,
            autoAlpha: 0,
            immediateRender: false,
            duration: 0.72,
            ease: 'power3.out',
            stagger: 0.08,
          });
        });

        const panel = root.querySelector<HTMLElement>('.launch-city-panel');
        if (!panel || !isDesktop) {
          window.requestAnimationFrame(() => ScrollTrigger.refresh());
          return undefined;
        }

        const xTo = gsap.quickTo(panel, 'x', { duration: 0.7, ease: 'power3.out' });
        const yTo = gsap.quickTo(panel, 'y', { duration: 0.7, ease: 'power3.out' });
        const rotateTo = gsap.quickTo(panel, 'rotationY', { duration: 0.9, ease: 'power3.out' });

        const onPointerMove = (event: PointerEvent) => {
          const rect = root.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          xTo(gsap.utils.mapRange(0, rect.width, -14, 14, localX));
          yTo(gsap.utils.mapRange(0, rect.height, -10, 10, localY));
          rotateTo(gsap.utils.mapRange(0, rect.width, 5, -5, localX));
        };

        root.addEventListener('pointermove', onPointerMove);
        window.requestAnimationFrame(() => ScrollTrigger.refresh());
        return () => root.removeEventListener('pointermove', onPointerMove);
      },
    );

    return () => mm.revert();
  }, { scope: rootRef });

  return (
    <div ref={rootRef} className="launch-page">
      <div className="launch-animated">
        <LaunchNav />
        <main>
          <HeroSection />
          <ProblemSection />
          <FeatureSection />
          <WorkflowSection />
          <AdvantageSection />
          <FinalCtaSection />
        </main>
      </div>
    </div>
  );
}

function LaunchNav() {
  return (
    <header className="launch-nav">
      <a className="launch-brand" href="#/" aria-label="Urban Taxi Vis 总页">
        <span className="launch-brand-mark">
          <CarFront size={19} aria-hidden="true" />
        </span>
        <span>
          <strong>Urban Taxi Vis</strong>
          <small>Beijing Mobility Lab</small>
        </span>
      </a>
      <nav className="launch-nav-actions" aria-label="页面导航">
        <a className="launch-ghost-link" href="#features">功能</a>
        <a className="launch-ghost-link" href="#advantages">优势</a>
        <a className="launch-nav-button" href={consoleHref}>
          <Sparkles size={17} aria-hidden="true" />
          <span>打开控制台</span>
        </a>
      </nav>
    </header>
  );
}

function HeroSection() {
  return (
    <section className="launch-hero" aria-labelledby="launch-title">
      <div className="launch-copy">
        <div className="launch-kicker launch-reveal">
          <span className="kicker-line" />
          Beijing Taxi Flow Intelligence
        </div>
        <h1 id="launch-title" className="launch-title launch-reveal">
          <span>北京出租车</span>
          <span>流动可视分析</span>
        </h1>
        <p className="launch-lead launch-reveal">
          面向北京出租车轨迹、区域供需、OD 流向和高频路径决策的一体化前端工作台。
          它不是静态图册，而是把城市运行证据组织成可以检索、比较、解释和推演的交互界面。
        </p>
        <div className="launch-actions launch-reveal">
          <a className="launch-primary" href={consoleHref}>
            <ArrowRight size={19} aria-hidden="true" />
            <span>打开控制台</span>
          </a>
          <a className="launch-secondary" href="#features">
            <MapPinned size={18} aria-hidden="true" />
            <span>查看能力</span>
          </a>
        </div>
        <div className="launch-metrics launch-reveal" aria-label="平台指标">
          <MetricItem icon={Database} label="Trajectory Points" value="百万级" />
          <MetricItem icon={Clock3} label="Temporal Window" value="全天候" />
          <MetricItem icon={Gauge} label="Analysis Modules" value="F1-F9" />
        </div>
      </div>
      <HeroVisual />
    </section>
  );
}

function MetricItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="metric-item">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HeroVisual() {
  return (
    <div className="launch-visual launch-reveal" aria-hidden="true">
      <div className="launch-city-panel">
        <div className="city-layer city-panel-head">
          <div>
            <span>Live Dispatch Surface</span>
            <strong>Beijing Taxi Flow</strong>
          </div>
          <Activity size={22} />
        </div>
        <div className="city-layer city-map">
          <div className="scan-beam" />
          <div className="district district-a" />
          <div className="district district-b" />
          <div className="district district-c" />
          <svg className="route-svg" viewBox="0 0 620 360" role="img" aria-label="北京出租车轨迹预览">
            <path className="route-line route-shadow" d="M30 260 C104 174 154 140 224 150 S340 218 426 152 538 86 594 96" />
            <path className="route-line route-flow route-flow-a" d="M30 260 C104 174 154 140 224 150 S340 218 426 152 538 86 594 96" />
            <path className="route-line route-flow route-flow-b" d="M50 92 C132 130 176 220 260 204 S360 110 444 132 538 210 592 162" />
            <path className="route-line route-flow route-flow-c" d="M102 304 C168 250 244 254 310 284 S438 322 540 250" />
          </svg>
          <span className="taxi-dot taxi-dot-a" />
          <span className="taxi-dot taxi-dot-b" />
          <span className="taxi-dot taxi-dot-c" />
          <span className="taxi-dot taxi-dot-d" />
          <span className="map-node map-node-a" />
          <span className="map-node map-node-b" />
          <span className="map-node map-node-c" />
        </div>
        <div className="city-layer city-panel-foot">
          <div className="city-readout">
            <span>Demand Pulse</span>
            <strong>87%</strong>
            <i className="metric-bar"><i className="metric-bar-fill" /></i>
          </div>
          <div className="city-readout">
            <span>OD Stability</span>
            <strong>0.74</strong>
            <i className="metric-bar"><i className="metric-bar-fill" /></i>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProblemSection() {
  return (
    <section className="product-section product-section--split" aria-labelledby="problem-title">
      <div className="section-copy section-reveal">
        <span className="section-eyebrow">Why It Matters</span>
        <h2 id="problem-title">城市出租车数据的难点，不只是“点太多”。</h2>
        <p>
          真正困难的是把离散轨迹、时间窗口、区域边界和道路候选路径串起来，
          让使用者能从宏观供需一路追到单车证据，再回到策略判断。
        </p>
      </div>
      <div className="problem-board section-reveal">
        <div>
          <span>原始轨迹</span>
          <strong>噪声、漂移、停驻片段混杂</strong>
        </div>
        <div>
          <span>区域分析</span>
          <strong>框选、网格、OD 口径难统一</strong>
        </div>
        <div>
          <span>决策表达</span>
          <strong>高频路径与候选方案缺少解释链</strong>
        </div>
      </div>
    </section>
  );
}

function FeatureSection() {
  return (
    <section id="features" className="product-section" aria-labelledby="features-title">
      <div className="section-heading section-reveal">
        <span className="section-eyebrow">Core Capability</span>
        <h2 id="features-title">从轨迹检索到策略推荐，一套控制台完成。</h2>
      </div>
      <div className="feature-grid">
        {productFeatures.map(({ code, title, description, icon: Icon }) => (
          <article key={code} className="feature-card section-reveal">
            <div className="feature-icon">
              <Icon size={22} aria-hidden="true" />
            </div>
            <span>{code}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section className="product-section product-section--panel" aria-labelledby="workflow-title">
      <div className="section-heading section-reveal">
        <span className="section-eyebrow">How It Works</span>
        <h2 id="workflow-title">把“看见现象”变成“追问原因”。</h2>
      </div>
      <div className="workflow-grid">
        <WorkflowStep icon={MapPinned} title="定位" text="从北京全局视角进入时间轴与地图，快速锁定异常区域。" />
        <WorkflowStep icon={Crosshair} title="下钻" text="框选区域、查看网格密度、追踪车辆和行程细节。" />
        <WorkflowStep icon={Network} title="关联" text="把 OD 流向、高频道路和候选路径放在同一分析链路里。" />
        <WorkflowStep icon={ShieldCheck} title="判断" text="用可解释指标辅助调度、治理、路线优化与运营复盘。" />
      </div>
    </section>
  );
}

function WorkflowStep({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <article className="workflow-step section-reveal">
      <Icon size={23} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function AdvantageSection() {
  return (
    <section id="advantages" className="product-section" aria-labelledby="advantages-title">
      <div className="section-heading section-reveal">
        <span className="section-eyebrow">Advantages</span>
        <h2 id="advantages-title">优势不是炫技，是让分析链路更短。</h2>
      </div>
      <div className="value-grid">
        {valueCards.map((card) => (
          <article key={card.label} className="value-card section-reveal">
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.text}</p>
          </article>
        ))}
      </div>
      <div className="console-preview section-reveal" aria-hidden="true">
        <div className="console-preview-header">
          <Layers3 size={18} />
          <span>Console Surface</span>
          <strong>Map + Timeline + Panels</strong>
        </div>
        <div className="console-preview-body">
          <div className="console-side">
            <i />
            <i />
            <i />
          </div>
          <div className="console-map">
            <Waypoints size={46} />
            <span className="console-line line-a" />
            <span className="console-line line-b" />
          </div>
          <div className="console-chart">
            <BarChart3 size={46} />
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCtaSection() {
  return (
    <section className="product-section final-cta" aria-labelledby="final-cta-title">
      <div className="section-reveal">
        <span className="section-eyebrow">Ready</span>
        <h2 id="final-cta-title">进入控制台，直接查看真实 Demo。</h2>
        <p>功能说明到这里结束，后续演示全部在交互式工作台中完成。</p>
        <a className="launch-primary" href={consoleHref}>
          <ArrowRight size={19} aria-hidden="true" />
          <span>打开控制台</span>
        </a>
      </div>
      <Building2 className="final-cta-mark" size={86} aria-hidden="true" />
    </section>
  );
}
