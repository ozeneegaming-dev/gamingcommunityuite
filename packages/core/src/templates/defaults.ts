/**
 * Șabloanele implicite (specul etapei 6, §3.2). Fiecare reproduce exact ieșirea componentei React de acum: cât timp
 * o temă nu modifică un șablon, site-ul randează componenta React; când îl modifică, pornește de la sursa de aici.
 *
 * `version` crește când sursa implicită se schimbă într-o actualizare GCS: suprascrierile pornite de la o versiune
 * mai veche apar „necesită revizuire”. Variabilele documentate aici apar lângă editor (și în autocompletare).
 */

export type GcsTemplateText = { ro: string; en: string };
/** O variabilă: calea (`forum.name`), tipul și descrierea. */
export type GcsTemplateVariable = { name: string; type: string; text: GcsTemplateText };
export type GcsTemplateSlot = { name: string; required: boolean; text: GcsTemplateText };

export type GcsTemplateDef = {
  key: string;
  group: GcsTemplateGroup;
  icon: string;
  version: number;
  title: GcsTemplateText;
  description: GcsTemplateText;
  variables: GcsTemplateVariable[];
  slots: GcsTemplateSlot[];
  /** `email`: sanitizat cu regulile emailurilor (fără sloturi). */
  mode: "site" | "email";
  /** Un șablon parțial, folosit doar prin `{% include %}`. */
  partial: boolean;
  source: string;
};

export const TEMPLATE_GROUPS = ["layout", "forum", "postbit", "members", "widgets", "email"] as const;
export type GcsTemplateGroup = (typeof TEMPLATE_GROUPS)[number];
export const TEMPLATE_GROUP_ICONS: Record<GcsTemplateGroup, string> = {
  layout: "fa-solid fa-table-columns",
  forum: "fa-solid fa-comments",
  postbit: "fa-solid fa-id-card",
  members: "fa-solid fa-users",
  widgets: "fa-solid fa-table-cells-large",
  email: "fa-solid fa-envelope",
};

type V = [name: string, type: string, ro: string, en: string];
const vars = (list: V[]): GcsTemplateVariable[] => list.map(([name, type, ro, en]) => ({ name, type, text: { ro, en } }));

/** Variabilele comune unui membru (folosit de `{% avatar %}` și `{% username %}`). */
const userVars = (p: string, ro: string, en: string): V[] => [
  [p, "user", ro, en],
  [`${p}.id`, "string", "ID-ul membrului", "Member ID"],
  [`${p}.name`, "string", "Numele", "Name"],
  [`${p}.url`, "string", "Linkul spre profil", "Profile link"],
  [`${p}.image`, "string|nil", "Avatarul (URL)", "Avatar URL"],
  [`${p}.nameKey`, "string", "Stilul numelui (clasa gcs-name--…)", "Name style (gcs-name--… class)"],
  [`${p}.frameKey`, "string|nil", "Rama avatarului", "Avatar frame"],
];

const common: V[] = [
  ["site.name", "string", "Numele site-ului", "Site name"],
  ["site.url", "string", "Adresa site-ului", "Site URL"],
  ["viewer.id", "string|nil", "Membrul care vede pagina (nil = vizitator)", "Viewing member (nil = guest)"],
  ["viewer.name", "string|nil", "Numele lui", "Their name"],
  ["locale", "string", "Limba paginii (ro, en…)", "Page language (ro, en…)"],
];

const FORUM_ROW = `<div class="gcs-forumRow" data-testid="gcs-forum-row">
  <span class="gcs-forumRow__icon" style="background: {{ forum.color | tint }}">
    <span class="gcs-forumIcon" style="color: {{ forum.color }}; font-size: 22px" aria-hidden="true" data-icon="{{ forum.icon }}">{% icon forum.icon %}</span>
  </span>
  <div class="gcs-forumRow__main">
    <span class="gcs-forumRow__title">
      {% if forum.external %}
        <a href="{{ forum.url }}" rel="noopener nofollow" target="_blank">{{ forum.name }}<span class="gcs-srOnly"> ({{ "forum.external" | t }})</span></a>
      {% else %}
        <a href="{{ forum.url }}">{{ forum.name }}</a>
      {% endif %}
      {% if forum.unread %}
        <span class="gcs-dot gcs-dot--unread" role="img" aria-label="{{ "forum.unread" | t }}" data-testid="gcs-unread-dot"></span>
      {% endif %}
    </span>
    {% if forum.description %}
      <span class="gcs-forumRow__desc">{{ forum.description }}</span>
    {% endif %}
    {% if forum.subforums.size > 0 %}
      <ul class="gcs-forumRow__subs" aria-label="{{ "forum.subforums" | t }}" style="grid-template-columns: repeat({{ forum.subforumColumns }}, minmax(0, 1fr))" data-columns="{{ forum.subforumColumns }}" data-testid="gcs-subforums">
        {% for sub in forum.subforums %}
          <li>
            <span class="gcs-forumIcon" style="color: var(--gcs-muted); font-size: 12px" aria-hidden="true" data-icon="{{ sub.icon }}">{% icon sub.icon %}</span>
            <a href="{{ sub.url }}">{{ sub.name }}</a>
            <span class="gcs-forumRow__subCount" title="{{ "forum.topicsCount" | t: count: sub.topicsCount }}">{{ sub.topicsCount }}</span>
          </li>
        {% endfor %}
      </ul>
    {% endif %}
  </div>
  {% unless forum.external %}
    <div class="gcs-forumRow__stats">
      <div>
        <strong>{{ forum.topicsCount }}</strong>
        {{ "forum.topics" | t }}
      </div>
      <div>
        <strong>{{ forum.postsCount }}</strong>
        {{ "forum.posts" | t }}
      </div>
    </div>
    <div class="gcs-forumRow__last">
      {% if forum.last %}
        {% if forum.last.user %}{% avatar forum.last.user, size: "s" %}{% endif %}
        <div class="gcs-forumRow__lastText">
          <a href="{{ forum.last.topicUrl }}" class="gcs-forumRow__lastTitle">{{ forum.last.topicTitle }}</a>
          <span>{% if forum.last.user %}{{ "forum.byWord" | t }} {% username forum.last.user %} · {% endif %}{% time forum.last.at %}</span>
        </div>
      {% else %}
        <span class="gcs-muted">{{ "forum.noPosts" | t }}</span>
      {% endif %}
    </div>
  {% endunless %}
</div>
`;

const TOPIC_ROW = `<div class="gcs-topicRow" data-testid="gcs-topic-row" data-topic-id="{{ topic.id }}">
  {% slot "select" %}
  <span class="gcs-topicRow__avatar">
    {% if topic.author %}{% avatar topic.author, size: "s" %}{% endif %}
  </span>
  <div class="gcs-topicRow__main">
    <div class="gcs-topicRow__badges">
      {% if topic.pinned %}<span class="gcs-badge gcs-badge--accent"><span class="gcs-badge__icon" aria-hidden="true">{% icon "fa-solid fa-thumbtack" %}</span>{{ "forum.pinned" | t }}</span>{% endif %}
      {% if topic.featured %}<span class="gcs-badge gcs-badge--warn"><span class="gcs-badge__icon" aria-hidden="true">{% icon "fa-solid fa-star" %}</span>{{ "forum.featured" | t }}</span>{% endif %}
      {% if topic.solved %}<span class="gcs-badge gcs-badge--ok"><span class="gcs-badge__icon" aria-hidden="true">{% icon "fa-solid fa-circle-check" %}</span>{{ "forum.solved" | t }}</span>{% endif %}
      {% if topic.locked %}<span class="gcs-badge gcs-badge--neutral"><span class="gcs-badge__icon" aria-hidden="true">{% icon "fa-solid fa-lock" %}</span>{{ "forum.locked" | t }}</span>{% endif %}
      {% if topic.visibility == "PENDING" %}<span class="gcs-badge gcs-badge--warn"><span class="gcs-badge__icon" aria-hidden="true">{% icon "fa-solid fa-hourglass-half" %}</span>{{ "forum.pending" | t }}</span>{% endif %}
      {% if topic.visibility == "HIDDEN" %}<span class="gcs-badge gcs-badge--neutral"><span class="gcs-badge__icon" aria-hidden="true">{% icon "fa-solid fa-eye-slash" %}</span>{{ "forum.hidden" | t }}</span>{% endif %}
      {% if topic.prefix %}<span class="gcs-badge" style="background: {{ topic.prefix.color | tint: 0.16 }}; color: {{ topic.prefix.color }}">{{ topic.prefix.name }}</span>{% endif %}
    </div>
    <span class="gcs-topicRow__title">
      <a href="{{ topic.url }}">{{ topic.title }}</a>
      {% if topic.unread %}
        <a href="{{ topic.unreadUrl }}" class="gcs-topicRow__unread" data-testid="gcs-unread-link"><span class="gcs-dot gcs-dot--unread" aria-hidden="true"></span>{{ "forum.firstUnread" | t }}</a>
      {% endif %}
    </span>
    <span class="gcs-topicRow__meta">
      {%- if topic.author %}{{ "forum.byWord" | t }} {% username topic.author %} · {% endif -%}
      {% time topic.createdAt %}
      {%- for tag in topic.tags %}<a href="{{ tag.url }}" class="gcs-tag">#{{ tag.name }}</a>{% endfor -%}
    </span>
  </div>
  <div class="gcs-topicRow__stats">
    <span>{% icon "fa-regular fa-comment", class: "gcs-metaIcon" %}{{ "forum.replies" | t: count: topic.repliesCount }}</span>
    <span>{% icon "fa-regular fa-eye", class: "gcs-metaIcon" %}{{ "forum.views" | t: count: topic.viewsCount }}</span>
  </div>
  <div class="gcs-topicRow__last">
    {% if topic.last.user %}{% username topic.last.user %}{% endif %}
    {% time topic.last.at %}
  </div>
</div>
`;

const POSTBIT_AUTHOR = `<div class="gcs-postbit__top">
  {% if author.hasData %}
    {% if author.online %}
      <span class="gcs-postbit__status gcs-postbit__status--on" data-testid="gcs-postbit-online" title="{{ "topic.author.online" | t }}"><span class="gcs-postbit__dot" aria-hidden="true"></span>{{ "topic.author.statusOnline" | t }}</span>
    {% else %}
      <span class="gcs-postbit__status"><span class="gcs-postbit__dot" aria-hidden="true"></span>{{ "topic.author.statusOffline" | t }}</span>
    {% endif %}
  {% endif %}
  <span class="gcs-postbit__handle">@{{ author.handle }}</span>
</div>

<div class="gcs-postbit__profile{% if author.cover %} gcs-postbit__profile--cover{% endif %}">
  {% if author.cover %}<span class="gcs-postbit__cover" aria-hidden="true" style="background: center {{ author.coverPositionY }}% / cover no-repeat url({{ author.cover }})" data-testid="gcs-postbit-cover"></span>{% endif %}
  <span class="gcs-postbit__avatar">{% avatar author, size: "l" %}</span>
  <div class="gcs-postbit__identity">
    <span class="gcs-post__authorName">{% username author %}</span>
    <span class="gcs-postbit__secondary"{% if author.vip %} data-testid="gcs-postbit-vip"{% endif %}>{{ author.secondary }}</span>
    {% if author.customTitle %}
      <span class="gcs-postbit__title" title="{{ author.customTitle }}">{% icon "fa-solid fa-id-badge" %}<span>{{ author.customTitle }}</span></span>
    {% endif %}
    {% if author.pips > 0 %}
      <span class="gcs-postbit__pips" role="img" aria-label="{{ "topic.author.rankLevel" | t: level: author.rankLevel }}">{% for i in (1..author.pips) %}{% icon "fa-solid fa-crown" %}{% endfor %}</span>
    {% endif %}
  </div>
</div>

<span class="gcs-postbit__group{% if author.group.banner %} gcs-postbit__group--colored{% endif %}"{% if author.group.banner %} style="background: {{ author.group.banner }}"{% endif %} data-testid="gcs-postbit-group">
  {% if author.group.icon %}{% icon author.group.icon %}{% endif %}
  <span>{{ author.group.label }}</span>
</span>

{% if author.hasData or author.rank %}
  <div class="gcs-postbit__rankBox" data-testid="gcs-postbit-xp">
    <div class="gcs-postbit__rankRow">
      <span class="gcs-postbit__rankIcon">{% if author.rank.symbol %}<span aria-hidden="true">{{ author.rank.symbol }}</span>{% else %}{% icon author.rankIcon %}{% endif %}</span>
      <span class="gcs-postbit__rankText">
        {% if author.rank %}<span class="gcs-post__rank" data-testid="gcs-post-rank">{{ author.rank.name }}</span>{% endif %}
        {% if author.hasData %}<span class="gcs-postbit__xpText">{{ author.xp.points | number }} XP</span>{% endif %}
      </span>
      {% if author.hasData %}
        <a class="gcs-postbit__badgeLink" href="{{ author.url }}?tab=badges">{% icon "fa-solid fa-trophy" %}<span>{{ "topic.author.badges" | t: count: author.badges.count }}</span></a>
      {% endif %}
    </div>
    {% if author.hasData %}
      {% if author.xp.next %}
        {% assign xpText = "topic.author.xpTo" | t: points: author.xp.points, next: author.xp.next, rank: author.xp.nextRank %}
      {% else %}
        {% assign xpText = "topic.author.xpMax" | t: points: author.xp.points %}
      {% endif %}
      <div class="gcs-postbit__xpBar" role="progressbar" aria-label="{{ "topic.author.xp" | t }}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="{{ author.xp.percent }}" aria-valuetext="{{ xpText }}"{% if author.xp.next %} title="{{ author.xp.points | number }} / {{ author.xp.next | number }} XP"{% endif %}>
        <span style="width: {{ author.xp.percent }}%"></span>
      </div>
      {% if author.badges.recent.size > 0 %}
        <ul class="gcs-postbit__badges" data-testid="gcs-postbit-badges">
          {% for b in author.badges.recent %}
            <li class="gcs-badgeArt__item">
              <span class="gcs-badgeArt__focus" title="{{ b.name }}{% if b.description %}: {{ b.description }}{% endif %}" tabindex="0">
                <img class="gcs-badgeArt gcs-badgeArt--32{% if b.image %} gcs-badgeArt--image{% endif %}" src="{% if b.image %}{{ b.image }}{% else %}{{ b.art }}{% endif %}" alt="{{ b.name }}" width="32" height="32" loading="lazy" decoding="async">
              </span>
            </li>
          {% endfor %}
          {% if author.badges.more > 0 %}
            <li class="gcs-badgeArt__item"><a class="gcs-badgeArt__more" href="{{ author.url }}?tab=badges" title="{{ "topic.author.badges" | t: count: author.badges.count }}">+{{ author.badges.more }}</a></li>
          {% endif %}
        </ul>
      {% endif %}
    {% endif %}
  </div>
{% endif %}

<dl class="gcs-postbit__rows">
  <div class="gcs-postbit__row" data-stat="posts">
    <dt><span class="gcs-postbit__rowIcon">{% icon "fa-solid fa-pen" %}</span>{{ "topic.author.posts" | t }}</dt>
    <dd>{{ author.postsCount | number }}</dd>
  </div>
  {% if author.hasData %}
    <div class="gcs-postbit__row" data-stat="topics">
      <dt><span class="gcs-postbit__rowIcon">{% icon "fa-solid fa-folder-open" %}</span>{{ "topic.author.topics" | t }}</dt>
      <dd>{{ author.topicsCount | number }}</dd>
    </div>
  {% endif %}
  <div class="gcs-postbit__row" data-stat="likes">
    <dt><span class="gcs-postbit__rowIcon">{% icon "fa-solid fa-heart" %}</span>{{ "topic.author.likes" | t }}</dt>
    <dd>{{ author.reputation | number }}</dd>
  </div>
</dl>
{% include "postbit.fields" %}
{% hook "postbit.after_fields" %}

<div class="gcs-postbit__foot">
  <span class="gcs-postbit__joined">{% icon "fa-regular fa-clock" %}{{ "topic.author.memberSince" | t }} <strong>{{ author.joinedAt | date: "date" }}</strong></span>
</div>

{% if author.motto %}
  <blockquote class="gcs-postbit__motto" title="{{ author.motto }}" aria-label="{{ "topic.author.motto" | t }}"><p>“{{ author.motto }}”</p></blockquote>
{% endif %}
`;

const POSTBIT_FIELDS = `{% if author.fields.size > 0 %}
  <dl class="gcs-postbit__rows gcs-postbit__fields" data-testid="gcs-postbit-fields">
    {% for f in author.fields %}
      <div class="gcs-postbit__row" data-field="{{ f.key }}">
        <dt><span class="gcs-postbit__rowIcon">{% icon f.icon %}</span>{{ f.label }}</dt>
        <dd>
          {%- if f.image %}<img src="{{ f.image }}" alt="" class="gcs-postbit__fieldImage">{% endif -%}
          {%- if f.type == "URL" -%}
            <a href="{{ f.value }}" rel="noopener nofollow ugc" target="_blank" class="gcs-postbit__fieldLink"><span>{{ f.display }}</span>{% icon "fa-solid fa-arrow-up-right-from-square" %}</a>
          {%- elsif f.image -%}
            <span class="gcs-srOnly">{{ f.value }}</span>
          {%- else -%}
            {{ f.value }}
          {%- endif -%}
        </dd>
      </div>
    {% endfor %}
  </dl>
{% endif %}
`;

const MEMBER_CARD = `<article class="gcs-card gcs-memberCard" data-testid="gcs-member-card">
  <span class="gcs-memberCard__avatar">
    {% avatar member, size: "l" %}
    {% if member.online %}<span class="gcs-postbit__online" role="img" aria-label="{{ "members.online" | t }}" title="{{ "members.online" | t }}"></span>{% endif %}
  </span>
  <strong class="gcs-memberCard__name">{% username member %}</strong>
  {% if member.customTitle %}<span class="gcs-postbit__title">{{ member.customTitle }}</span>{% endif %}
  <span class="gcs-badge"{% if member.group.color %} style="background: {{ member.group.color | tint: 0.16 }}; color: {{ member.group.color }}"{% endif %}>{{ member.group.name }}</span>
  {% if member.rank %}<span class="gcs-post__rank">{{ member.rank.name }}</span>{% endif %}
  <dl class="gcs-memberCard__stats">
    <div>
      <dt>{{ "members.posts" | t }}</dt>
      <dd>{{ member.postsCount | number }}</dd>
    </div>
    <div>
      <dt>{{ "members.reputation" | t }}</dt>
      <dd>{{ member.reputation | number }}</dd>
    </div>
  </dl>
  {% assign joined = member.joinedAt | date: "date" %}
  <span class="gcs-postbit__joined">{{ "members.joined" | t: date: joined }}</span>
</article>
`;

const HOVER_CARD = `<div class="gcs-card gcs-hoverCard" role="dialog" aria-label="{{ user.name }}" data-testid="gcs-hover-card">
  {% if user.cover %}
    <div class="gcs-hoverCard__cover gcs-hoverCard__cover--image" style="--gcs-hoverCard-accent: {{ user.accentColor }}; background: center {{ user.coverPositionY }}% / cover no-repeat url({{ user.cover }})" data-testid="gcs-hover-cover"></div>
  {% else %}
    <div class="gcs-hoverCard__cover" style="--gcs-hoverCard-accent: {{ user.accentColor }}; background: linear-gradient(120deg, {{ user.accentColor | tint: 0.55 }}, {{ user.accentColor | tint: 0.12 }})" data-testid="gcs-hover-cover"></div>
  {% endif %}
  <div class="gcs-hoverCard__body">
    <div class="gcs-hoverCard__head">
      <span class="gcs-hoverCard__avatar">{% avatar user, size: "l" %}</span>
      <div class="gcs-hoverCard__identity">
        <a href="{{ user.url }}" class="gcs-userLink gcs-name--{{ user.nameKey }} gcs-hoverCard__name" title="{{ user.name }}" data-text="{{ user.name }}">{{ user.name }}</a>
        <div class="gcs-hoverCard__meta">
          <span class="gcs-badge gcs-hoverCard__group" style="--gcs-hoverCard-group: {{ user.group.color | default: "var(--gcs-muted)" }}">{{ user.group.name }}</span>
          {% if user.rank %}<span class="gcs-hoverCard__rank" data-testid="gcs-hover-rank">{% if user.rank.symbol %}{{ user.rank.symbol }} {% endif %}{{ user.rank.name }}</span>{% endif %}
          {% if online %}<span class="gcs-hoverCard__online"><span class="gcs-dot" aria-hidden="true"></span>{{ "hoverCard.online" | t }}</span>{% endif %}
        </div>
      </div>
    </div>
    {% if user.bio %}<p class="gcs-hoverCard__bio">{{ user.bio }}</p>{% endif %}
    {% if badges.size > 0 %}
      <ul class="gcs-hoverCard__badges" aria-label="Badges">
        {% for b in badges %}
          <li title="{{ b.name }}{% if b.description %}: {{ b.description }}{% endif %}" class="gcs-badgeArt__item">
            <img class="gcs-badgeArt gcs-badgeArt--32{% if b.image %} gcs-badgeArt--image{% endif %}" src="{% if b.image %}{{ b.image }}{% else %}{{ b.art }}{% endif %}" alt="{{ b.name }}" width="32" height="32" loading="lazy" decoding="async">
          </li>
        {% endfor %}
      </ul>
    {% endif %}
    {% if fields.size > 0 %}
      <dl class="gcs-hoverCard__fields">
        {% for f in fields %}<div><dt>{{ f.label }}</dt><dd title="{{ f.value }}">{{ f.value }}</dd></div>{% endfor %}
      </dl>
    {% endif %}
    <div class="gcs-hoverCard__stats">
      <div><strong>{{ stats.posts | number }}</strong>{{ "hoverCard.posts" | t }}</div>
      <div><strong class="{% if stats.reputation >= 0 %}gcs-rep--pos{% else %}gcs-rep--neg{% endif %}">{% if stats.reputation > 0 %}+{% endif %}{{ stats.reputation | number }}</strong>{{ "hoverCard.reputation" | t }}</div>
      <div><strong data-testid="gcs-hover-followers">{{ stats.followers | number }}</strong>{{ "hoverCard.followers" | t }}</div>
      <div><strong>{{ stats.joinedAt | date: "year" }}</strong>{{ "hoverCard.joined" | t }}</div>
    </div>
    {% if viewer.canFollow or viewer.canMessage %}
      <div class="gcs-hoverCard__actions">{% slot "actions" %}</div>
    {% endif %}
  </div>
</div>
`;

const FOOTER = `<footer class="gcs-siteFooter">
  <div class="gcs-siteFooter__inner">
    <div class="gcs-siteFooter__brand">
      <strong class="gcs-display">{{ site.name }}</strong>
      <span>© {{ year }} {{ site.name }}</span>
    </div>
    <nav aria-label="{{ "site.footerNav" | t }}" class="gcs-siteFooter__links">
      <a href="/members">{% icon "fa-solid fa-users" %}{{ "site.nav.members" | t }}</a>
      <a href="/staff">{% icon "fa-solid fa-shield-halved" %}{{ "site.nav.staff" | t }}</a>
      <a href="/search">{% icon "fa-solid fa-magnifying-glass" %}{{ "site.searchLabel" | t }}</a>
    </nav>
    <div class="gcs-siteFooter__prefs">
      {% slot "language" %}
      {% slot "scheme" %}
    </div>
    {% slot "powered" %}
  </div>
</footer>
`;

const WIDGET_CARD = `<section class="gcs-card gcs-sideCard gcs-widget" aria-labelledby="{{ widget.headingId }}" data-widget="{{ widget.type }}"{% if widget.testId %} data-testid="{{ widget.testId }}"{% endif %}>
  <h2 id="{{ widget.headingId }}" class="gcs-display gcs-widgetTitle gcs-sideCard__title">
    {% if widget.icon %}<span class="gcs-widgetTitle__icon" aria-hidden="true">{% icon widget.icon %}</span>{% endif %}
    <span class="gcs-widgetTitle__text">{{ widget.title }}</span>
    {% if widget.hasExtra %}<span class="gcs-widgetTitle__extra">{% slot "extra" %}</span>{% endif %}
  </h2>
  {% slot "content" %}
</section>
`;

const EMAIL_LAYOUT = `{{ content }}
`;

const T = (ro: string, en: string): GcsTemplateText => ({ ro, en });
const slot = (name: string, required: boolean, ro: string, en: string): GcsTemplateSlot => ({ name, required, text: { ro, en } });

export const DEFAULT_TEMPLATES: GcsTemplateDef[] = [
  {
    key: "layout.footer",
    group: "layout",
    icon: "fa-solid fa-shoe-prints",
    version: 1,
    title: T("Subsolul site-ului", "Site footer"),
    description: T("Subsolul tuturor paginilor: numele site-ului, linkurile utile, limba și modul de culori.", "The footer of every page: site name, useful links, language and colour mode."),
    variables: vars([...common, ["year", "number", "Anul curent", "Current year"]]),
    slots: [
      slot("language", false, "Butoanele de limbă", "Language buttons"),
      slot("scheme", false, "Butoanele modului de culori", "Colour mode buttons"),
      slot("powered", true, "Mențiunea „Powered by GamingCommunitySuite” (apare oricum)", "The “Powered by GamingCommunitySuite” line (always shown)"),
    ],
    mode: "site",
    partial: false,
    source: FOOTER,
  },
  {
    key: "forum.row",
    group: "forum",
    icon: "fa-solid fa-folder",
    version: 1,
    title: T("Rândul unui forum", "Forum row"),
    description: T("Un forum în lista de pe pagina principală și în subforumuri.", "A forum in the index list and in subforum lists."),
    variables: vars([
      ...common,
      ["forum.id", "number", "ID-ul forumului", "Forum ID"],
      ["forum.name", "string", "Numele", "Name"],
      ["forum.description", "string", "Descrierea", "Description"],
      ["forum.url", "string", "Linkul (sau adresa externă)", "Link (or external address)"],
      ["forum.external", "boolean", "E un link extern", "Is an external link"],
      ["forum.icon", "string", "Iconița Font Awesome", "Font Awesome icon"],
      ["forum.color", "string", "Culoarea (#RRGGBB)", "Colour (#RRGGBB)"],
      ["forum.unread", "boolean", "Are mesaje necitite", "Has unread posts"],
      ["forum.topicsCount", "number", "Topicuri", "Topics"],
      ["forum.postsCount", "number", "Postări", "Posts"],
      ["forum.subforumColumns", "number", "Coloanele subforumurilor", "Subforum columns"],
      ["forum.subforums", "list", "Subforumurile: id, name, url, icon, topicsCount", "Subforums: id, name, url, icon, topicsCount"],
      ["forum.last", "object|nil", "Ultimul mesaj", "Latest post"],
      ["forum.last.topicTitle", "string", "Titlul topicului", "Topic title"],
      ["forum.last.topicUrl", "string", "Linkul topicului", "Topic link"],
      ["forum.last.at", "date", "Data", "Date"],
      ...userVars("forum.last.user", "Autorul ultimului mesaj (sau nil)", "Latest post author (or nil)"),
    ]),
    slots: [],
    mode: "site",
    partial: false,
    source: FORUM_ROW,
  },
  {
    key: "forum.topic_row",
    group: "forum",
    icon: "fa-solid fa-list",
    version: 1,
    title: T("Rândul unui topic", "Topic row"),
    description: T("Un topic în lista unui forum sau a unui tag.", "A topic in a forum or tag list."),
    variables: vars([
      ...common,
      ["topic.id", "number", "ID-ul topicului", "Topic ID"],
      ["topic.title", "string", "Titlul", "Title"],
      ["topic.url", "string", "Linkul", "Link"],
      ["topic.unreadUrl", "string", "Linkul spre prima postare necitită", "Link to the first unread post"],
      ["topic.unread", "boolean", "Are postări necitite", "Has unread posts"],
      ["topic.pinned", "boolean", "Fixat", "Pinned"],
      ["topic.featured", "boolean", "Evidențiat", "Featured"],
      ["topic.solved", "boolean", "Rezolvat", "Solved"],
      ["topic.locked", "boolean", "Blocat", "Locked"],
      ["topic.visibility", "string", "VISIBLE, PENDING sau HIDDEN", "VISIBLE, PENDING or HIDDEN"],
      ["topic.prefix", "object|nil", "Prefixul: name, color", "Prefix: name, color"],
      ["topic.tags", "list", "Tag-urile: name, url", "Tags: name, url"],
      ["topic.createdAt", "date", "Data creării", "Created at"],
      ["topic.repliesCount", "number", "Răspunsuri", "Replies"],
      ["topic.viewsCount", "number", "Vizualizări", "Views"],
      ["topic.last.at", "date", "Data ultimului mesaj", "Latest post date"],
      ...userVars("topic.author", "Autorul (sau nil)", "Author (or nil)"),
      ...userVars("topic.last.user", "Autorul ultimului mesaj (sau nil)", "Latest post author (or nil)"),
    ]),
    slots: [slot("select", true, "Bifa de selecție a moderatorului (doar pentru moderatori)", "The moderator's selection checkbox (moderators only)")],
    mode: "site",
    partial: false,
    source: TOPIC_ROW,
  },
  {
    key: "postbit.author",
    group: "postbit",
    icon: "fa-solid fa-user-tag",
    version: 2,
    title: T("Autorul postării (postbit)", "Post author (postbit)"),
    description: T("Coloana cu autorul, lângă fiecare postare.", "The author column next to every post."),
    variables: vars([
      ...common,
      ...userVars("author", "Autorul postării", "Post author"),
      ["author.handle", "string", "Numele cu litere mici (@handle)", "Lower-case name (@handle)"],
      ["author.hasData", "boolean", "Datele extinse sunt disponibile (grup, XP, insigne, câmpuri)", "Extended data is available (group, XP, badges, fields)"],
      ["author.online", "boolean", "E online", "Is online"],
      ["author.secondary", "string", "Rândul al doilea: planul VIP, un grup secundar sau grupul", "Second line: VIP plan, a secondary group or the group"],
      ["author.customTitle", "string|nil", "Titlul personalizat", "Custom title"],
      ["author.cover", "string|nil", "Coperta profilului (URL), dacă profilul e vizibil viewer-ului", "Profile cover (URL), if the profile is visible to the viewer"],
      ["author.coverPositionY", "number", "Poziția verticală a copertei (0–100 %)", "Vertical cover position (0–100 %)"],
      ["author.vip", "boolean", "Are un plan VIP activ", "Has an active VIP plan"],
      ["author.rankLevel", "number|nil", "Nivelul rangului", "Rank level"],
      ["author.pips", "number", "Coroanele afișate (0–8)", "Crowns shown (0–8)"],
      ["author.rank", "object|nil", "Rangul: name, symbol (emoji)", "Rank: name, symbol (emoji)"],
      ["author.rankIcon", "string", "Iconița rangului (Font Awesome)", "Rank icon (Font Awesome)"],
      ["author.group.label", "string", "Grupul afișat în bară", "Group shown in the bar"],
      ["author.group.icon", "string|nil", "Iconița grupului", "Group icon"],
      ["author.group.banner", "string|nil", "Fundalul barei (culoare sau gradient)", "Bar background (colour or gradient)"],
      ["author.xp.points", "number", "Punctele XP", "XP points"],
      ["author.xp.next", "number|nil", "Pragul rangului următor", "Next rank threshold"],
      ["author.xp.nextRank", "string|nil", "Rangul următor", "Next rank"],
      ["author.xp.percent", "number", "Progresul (0–100)", "Progress (0–100)"],
      ["author.badges.count", "number", "Insignele obținute", "Badges earned"],
      ["author.badges.recent", "list", "Ultimele insigne: name, description, art (adresa insignei), image (imaginea proprie), color, icon, symbol, initial", "Latest badges: name, description, art (emblem URL), image (custom image), color, icon, symbol, initial"],
      ["author.badges.more", "number", "Câte insigne nu încap în rând (+N)", "How many badges don't fit in the row (+N)"],
      ["author.postsCount", "number", "Postări", "Posts"],
      ["author.topicsCount", "number", "Topicuri", "Topics"],
      ["author.reputation", "number", "Aprecieri", "Likes"],
      ["author.joinedAt", "date", "Data înscrierii", "Joined at"],
      ["author.motto", "string|nil", "Motto-ul (ultimul status)", "Motto (latest status)"],
      ["author.fields", "list", "Câmpurile din postbit: key, label, icon, type, value, display, image", "Postbit fields: key, label, icon, type, value, display, image"],
      ["post.id", "number", "ID-ul postării", "Post ID"],
      ["post.number", "number", "Numărul postării în topic", "Post number in the topic"],
    ]),
    slots: [],
    mode: "site",
    partial: false,
    source: POSTBIT_AUTHOR,
  },
  {
    key: "postbit.fields",
    group: "postbit",
    icon: "fa-solid fa-list-ul",
    version: 1,
    title: T("Câmpurile din postbit", "Postbit fields"),
    description: T("Câmpurile de profil alese pentru postbit; inclus de „Autorul postării”.", "Profile fields chosen for the postbit; included by “Post author”."),
    variables: vars([["author.fields", "list", "Câmpurile: key, label, icon, type, value, display, image", "Fields: key, label, icon, type, value, display, image"]]),
    slots: [],
    mode: "site",
    partial: true,
    source: POSTBIT_FIELDS,
  },
  {
    key: "members.card",
    group: "members",
    icon: "fa-solid fa-address-card",
    version: 1,
    title: T("Cardul unui membru", "Member card"),
    description: T("Un membru în listele /members și /staff.", "A member in the /members and /staff lists."),
    variables: vars([
      ...common,
      ...userVars("member", "Membrul", "The member"),
      ["member.online", "boolean", "E online", "Is online"],
      ["member.customTitle", "string|nil", "Titlul personalizat", "Custom title"],
      ["member.group.name", "string", "Grupul", "Group"],
      ["member.group.color", "string|nil", "Culoarea grupului", "Group colour"],
      ["member.rank", "object|nil", "Rangul: name", "Rank: name"],
      ["member.postsCount", "number", "Postări", "Posts"],
      ["member.reputation", "number", "Reputație", "Reputation"],
      ["member.joinedAt", "date", "Data înscrierii", "Joined at"],
    ]),
    slots: [],
    mode: "site",
    partial: false,
    source: MEMBER_CARD,
  },
  {
    key: "members.hover_card",
    group: "members",
    icon: "fa-solid fa-id-card-clip",
    version: 2,
    title: T("Hover card-ul unui membru", "Member hover card"),
    description: T("Cardul care apare la trecerea mouse-ului peste un nume.", "The card shown when hovering a member name."),
    variables: vars([
      ...common,
      ...userVars("user", "Membrul", "The member"),
      ["user.bio", "string", "Descrierea scurtă", "Short bio"],
      ["user.accentColor", "string|nil", "Culoarea de accent", "Accent colour"],
      ["user.cover", "string|nil", "Imaginea de copertă", "Cover image"],
      ["user.coverPositionY", "number", "Poziția verticală a copertei (0–100 %)", "Vertical cover position (0–100 %)"],
      ["user.group.name", "string", "Grupul", "Group"],
      ["user.group.color", "string|nil", "Culoarea grupului", "Group colour"],
      ["user.rank", "object|nil", "Rangul: name, icon, symbol (emoji-ul, dacă iconița nu e Font Awesome)", "Rank: name, icon, symbol (the emoji, if the icon is not Font Awesome)"],
      ["stats.posts", "number", "Postări", "Posts"],
      ["stats.reputation", "number", "Reputație", "Reputation"],
      ["stats.followers", "number", "Urmăritori", "Followers"],
      ["stats.joinedAt", "date", "Data înscrierii", "Joined at"],
      ["online", "boolean", "E online", "Is online"],
      ["badges", "list", "Insignele: key, name, description, art (adresa insignei), image (imaginea proprie), symbol, color", "Badges: key, name, description, art (emblem URL), image (custom image), symbol, color"],
      ["fields", "list", "Câmpurile de pe card: label, value", "Card fields: label, value"],
      ["viewer.canFollow", "boolean", "Viewer-ul îl poate urmări", "The viewer can follow"],
      ["viewer.canMessage", "boolean", "Viewer-ul îi poate scrie", "The viewer can message"],
      ["viewer.isFollowing", "boolean", "Viewer-ul îl urmărește deja", "The viewer already follows"],
    ]),
    slots: [slot("actions", false, "Butoanele „Urmărește” și „Mesaj”", "The “Follow” and “Message” buttons")],
    mode: "site",
    partial: false,
    source: HOVER_CARD,
  },
  {
    key: "widgets.card",
    group: "widgets",
    icon: "fa-solid fa-square",
    version: 1,
    title: T("Cardul unui widget", "Widget card"),
    description: T("Cardul comun al widget-urilor (titlul cu iconiță și conținutul).", "The common widget card (title with icon and content)."),
    variables: vars([
      ...common,
      ["widget.id", "string", "ID-ul amplasării", "Placement ID"],
      ["widget.type", "string", "Tipul widget-ului (ex. forums.recent_topics)", "Widget type (e.g. forums.recent_topics)"],
      ["widget.title", "string", "Titlul", "Title"],
      ["widget.icon", "string|nil", "Iconița Font Awesome", "Font Awesome icon"],
      ["widget.headingId", "string", "ID-ul titlului (pentru aria-labelledby)", "Heading ID (for aria-labelledby)"],
      ["widget.hasExtra", "boolean", "Are conținut lângă titlu (slotul extra)", "Has content next to the title (extra slot)"],
      ["widget.testId", "string|nil", "Identificatorul de test", "Test identifier"],
    ]),
    slots: [slot("content", true, "Conținutul widget-ului", "The widget content"), slot("extra", false, "Conținutul de lângă titlu (ex. perioada)", "Content next to the title (e.g. period)")],
    mode: "site",
    partial: false,
    source: WIDGET_CARD,
  },
  {
    key: "email.layout",
    group: "email",
    icon: "fa-solid fa-envelope-open-text",
    version: 1,
    title: T("Învelișul emailurilor", "Email layout"),
    description: T(
      "HTML-ul din jurul fiecărui email trimis de site (notificări, digest, confirmări). Fără texte traduse: emailurile pleacă în limba site-ului.",
      "The HTML around every email sent by the site (notifications, digest, confirmations). No translated texts: emails use the site language.",
    ),
    variables: vars([
      ["site.name", "string", "Numele site-ului", "Site name"],
      ["site.url", "string", "Adresa site-ului", "Site URL"],
      ["subject", "string", "Subiectul emailului", "Email subject"],
      ["content", "html", "Corpul emailului (HTML deja sigur)", "Email body (already safe HTML)"],
      ["year", "number", "Anul curent", "Current year"],
    ]),
    slots: [],
    mode: "email",
    partial: false,
    source: EMAIL_LAYOUT,
  },
];

const BY_KEY = new Map(DEFAULT_TEMPLATES.map((d) => [d.key, d]));

export function defaultTemplate(key: string): GcsTemplateDef | null {
  return BY_KEY.get(key) ?? null;
}
