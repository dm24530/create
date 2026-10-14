// 灵感库模板：完整提示词 + 镜头思路 + 推荐参数，一键带入工作台。
// 参数（时长/画幅/分辨率/参考素材）与工作台的请求字段一一对应。

import { fetchOnlineInspirationsFromServer } from './videoArchiveApi'

export interface VideoInspirationTemplate {
  slug: string
  title: string
  category: string
  summary: string
  prompt: string
  tips: string
  checkpoints: string
  durationSeconds: number
  aspectRatio: string
  resolution: string
  requiresImages: number
  requiresVideo: boolean
  requiresAudio: boolean
  hue: number
}

export const VIDEO_INSPIRATION_TEMPLATES: VideoInspirationTemplate[] = [
  {
    slug: 'perfume-light-reveal',
    title: '香水瓶的光影揭幕',
    category: '产品广告',
    summary: '产品开场、品牌短片镜头练习。',
    prompt:
      '一只无品牌、无文字的透明方形香水瓶立在深灰色石台中央，瓶内是淡琥珀色液体。镜头从瓶身左前方缓慢向右移动，始终保持中近景；一条柔和的窄光带从左侧扫过玻璃边缘，显露瓶盖的金属质感和瓶内折射。背景保持深色，瓶身与石台固定不动。前两秒展示侧面轮廓，随后光线逐渐照亮正面，最后一秒停在干净、稳定的产品构图。真实商业摄影质感，克制的高光，无新增物体、字幕或场景切换。',
    tips: '若瓶身变形，减少横向移动，改成轻微推进；若出现标识，进一步简化瓶体描述。',
    checkpoints: '瓶形是否稳定、光线移动是否连续、透明材质是否自然。',
    durationSeconds: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 210,
  },
  {
    slug: 'morning-coffee-pour',
    title: '清晨的一杯咖啡',
    category: '美食饮品',
    summary: '餐饮社媒、美食短片。',
    prompt:
      '清晨窗边的木桌上，一只白色陶瓷杯中装着黑咖啡，暖阳从画面左侧照进来。固定的微距中近景，镜头只做非常缓慢的推进。细细一股牛奶从画面上方倒入咖啡中央，浅色纹路缓慢扩散，形成自然流动的旋涡；少量热气向上飘起。前两秒只有咖啡和轻微热气，中间四秒缓慢倒入牛奶，最后两秒液面逐渐平静。杯口保持圆润稳定，桌面干净，浅景深，不出现手、文字、快速剪辑或夸张飞溅。',
    tips: '若倒液复杂，先只生成咖啡热气，再测试加入牛奶的版本。',
    checkpoints: '液体是否符合运动直觉，杯口是否变形，时间顺序是否大体符合描述。',
    durationSeconds: 8,
    aspectRatio: '9:16',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 28,
  },
  {
    slug: 'mountain-cloud-dolly',
    title: '云海中的山脊',
    category: '自然风景',
    summary: '旅行、自然风景、横幅展示。',
    prompt:
      '日出前后的高山山脊，近处深色岩石清晰，远处层层山峰被低处云海包围。一个连续的航拍感镜头沿山脊缓慢向前移动，高度保持稳定；云层在山谷中轻轻流动，太阳从画面右侧带来柔和金色侧光。保持地形和山峰轮廓连贯，远景有真实的大气透视。前景岩石逐渐从画面下方掠过，最后停留在开阔的群山构图。自然纪录片质感，不出现建筑、人物、文字、突然加速或昼夜切换。',
    tips: '若地形漂移，改成固定机位、仅云海缓慢流动。',
    checkpoints: '地形稳定、前后景视差、云的运动是否自然。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 195,
  },
  {
    slug: 'clay-fox-starlight',
    title: '小狐狸发现星光',
    category: '动画短片',
    summary: '风格动画、简短叙事。',
    prompt:
      '手工黏土动画风格，一只圆润的橙色小狐狸站在深蓝色微型森林里，身旁有一片低矮草地。固定中景，保持同一角色和同一场景。前两秒小狐狸好奇地低头；随后草地上一个小小的暖黄色光点慢慢升起，小狐狸抬头看着它，耳朵轻轻动一下；光点在狐狸鼻尖前停留，最后狐狸露出轻微微笑。动作简单且有停顿，保留黏土材质的柔软颗粒感和温暖侧光，不加入其他角色、对白文字或突然的镜头切换。',
    tips: '若动作过多，去掉微笑或耳朵动作，仅保留抬头跟随光点。',
    checkpoints: '角色造型连续、动作顺序、黏土风格是否一致。',
    durationSeconds: 10,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 235,
  },
  {
    slug: 'product-photo-orbit',
    title: '商品图变成展示镜头',
    category: '多图参考',
    summary: '将现有生图或产品照片变成短视频。',
    prompt:
      '以上传的参考图 1 中的商品为唯一主体，保持它的外形、材质、颜色和已有图案。商品固定放在原有台面上，镜头从正面向右侧做一个非常小幅度的弧形移动，同时略微推进，始终让商品完整留在画面中。柔和侧光逐渐显露表面纹理和边缘高光，背景保持简洁、稳定。整个镜头缓慢、连续，最后半秒停稳。不要让商品旋转、拆解或变形，不增加附件，不修改已有标识，不出现新的文字或场景切换。',
    tips: '若涉及细小文字或精确标识，使用固定机位和光线变化，减少新视角；不能保证所有标识准确。',
    checkpoints: '与原图的形状一致性、标识漂移、视角变化是否合理。',
    durationSeconds: 5,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 158,
  },
  {
    slug: 'character-into-scene',
    title: '角色走进新场景',
    category: '多图参考',
    summary: '角色与场景组合、多图参考入门。',
    prompt:
      '使用参考图 1 的角色外形、服装和配色，将其放入参考图 2 的公园小路场景。角色以自然比例站在小路中景，光线与场景中的黄昏方向一致。角色缓慢向镜头走两三步，然后停下，轻轻看向旁边的树木。镜头在固定位置做极缓慢的推进，保持同一构图和场景。保留角色身份、服装细节和背景结构，使脚步与地面接触自然，不添加其他角色、字幕或新的场景，不突然改变角色的大小。',
    tips: '若走路不稳定，角色原地站立，仅转动视线；先统一两图画风。',
    checkpoints: '两种参考的融合、光线、脚与地面接触、角色尺度。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 2,
    requiresVideo: false,
    requiresAudio: false,
    hue: 128,
  },
  {
    slug: 'portrait-window-turn',
    title: '窗边侧脸回眸',
    category: '人物肖像',
    summary: '人像特写、情绪镜头。',
    prompt:
      '一位年轻人坐在窗边，侧脸对着镜头，窗外是冬季午后的柔和散射光。固定机位的中近景，人物前两秒保持静止，呼吸均匀；随后头部极缓慢地转向镜头，眼神从窗外移到画面中心，最后停住，眼神平静。光线沿鼻梁与颧骨形成柔和过渡，背景略微虚化但结构稳定。保持同一张脸、同一发型与服装，不改变年龄或性别，不出现多余人物、文字、镜头晃动或快速转场。',
    tips: '人像特写优先减少动作：只保留一次转头，其余时间静止，成功率更高。',
    checkpoints: '面部是否变形、五官是否连续、光线方向是否一致。',
    durationSeconds: 5,
    aspectRatio: '3:4',
    resolution: '720p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 22,
  },
  {
    slug: 'architecture-desk-loop',
    title: '建筑空间缓移',
    category: '建筑空间',
    summary: '空间展示、地产与室内短片。',
    prompt:
      '现代极简混凝土住宅的室内空间，午后的斜射光穿过落地窗落在浅色地面上。镜头贴地缓慢向前平移，经过一张低矮木桌，最后停在窗外的庭院。空间结构、墙面比例与家具位置全程保持稳定，光影随时间轻轻变化。材质要有真实的粗糙度与反射，不出现人物、文字、镜头抖动、镜头切换或夸张的广角畸变。整体克制、安静，适合作为空间展示的开场镜头。',
    tips: '若透视畸变明显，缩短平移距离并降低移动速度。',
    checkpoints: '结构线条是否笔直、光影是否连续、材质是否一致。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 45,
  },
  {
    slug: 'scifi-orbital-arrival',
    title: '轨道站的清晨',
    category: '科幻场景',
    summary: '概念片头、科幻氛围铺陈。',
    prompt:
      '空间站在行星晨昏线附近缓慢自转，巨大的太阳能板反射着一线阳光。镜头从站点外侧远处开始，缓慢向空间站主体推进，前景有极少量尘埃粒子掠过。行星表面是深蓝色的大气与云层，明亮弧线从画面右侧逐渐延伸。整体保持同一站点结构，光照方向一致，运动连续缓慢。不出现文字、飞船爆炸、快速剪辑或突变的光照。电影级质感，冷色调，细节克制。',
    tips: '若结构漂移，减少自转速度并保持机位固定，仅做缓慢推进。',
    checkpoints: '结构是否稳定、光照方向、推进速度是否均匀。',
    durationSeconds: 8,
    aspectRatio: '21:9',
    resolution: '1080p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 265,
  },
  {
    slug: 'drone-coastline-audio',
    title: '海岸线低空掠过',
    category: '自然风景',
    summary: '航拍风格镜头，带环境声。',
    prompt:
      '黄昏时分的海岸线，浪花沿礁石反复拍打，远处海面泛着淡淡金光。镜头以低空航拍视角沿海岸线平稳向前飞行，速度均匀，高度几乎不变；前景礁石快速掠过，远处海岸线保持连贯。海浪的形态与节奏自然，泡沫随潮水退去。不出现建筑、船只、文字或镜头抖动，昼夜不切换。真实纪录片质感，画面干净，可加入现场海浪的环境声。',
    tips: '需要环境声时，打开「生成音频」；若只想要纯画面，保持关闭。',
    checkpoints: '海岸线是否连续、浪花运动是否自然、飞行速度是否均匀。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: true,
    hue: 205,
  },
]

export function findVideoInspiration(slug: string): VideoInspirationTemplate | null {
  const key = slug.trim()
  if (!key) return null
  return VIDEO_INSPIRATION_TEMPLATES.find((item) => item.slug === key) || null
}

export function videoInspirationCategories(): string[] {
  return Array.from(new Set(VIDEO_INSPIRATION_TEMPLATES.map((item) => item.category)))
}

/* ----------------------------- 在线灵感 -----------------------------
 * 拉取与媒体回源都放在服务端（见 videoArchiveApi.ts）：第三方站点在国内网络
 * 常不可达，服务端可以复用 update.proxy_url 里配好的代理，媒体再由本站代理转发，
 * 于是访问者只需要能访问本站。
 */

export interface OnlineInspirationItem {
  id: string
  mediaType: 'video' | 'image'
  mediaUrl: string
  posterUrl: string
  prompt: string
  negativePrompt: string
  model: string
  author: string
  width: number
  height: number
  likes: number
  sourceUrl: string
}

export interface FetchOnlineInspirationsOptions {
  limit?: number
  mediaType?: 'video' | 'image'
  refresh?: boolean
  signal?: AbortSignal
}

export async function fetchOnlineInspirations(
  options: FetchOnlineInspirationsOptions = {},
): Promise<OnlineInspirationItem[]> {
  const entries = await fetchOnlineInspirationsFromServer(
    options.mediaType ?? 'video',
    Math.min(Math.max(options.limit ?? 24, 1), 48),
    options.refresh === true,
  )
  return entries.map((entry) => ({
    id: String(entry.id),
    mediaType: entry.media_type === 'image' ? 'image' : 'video',
    mediaUrl: String(entry.media_url ?? ''),
    posterUrl: String(entry.poster_url ?? ''),
    prompt: String(entry.prompt ?? ''),
    negativePrompt: String(entry.negative_prompt ?? ''),
    model: String(entry.model ?? ''),
    author: String(entry.author ?? ''),
    width: Number(entry.width ?? 0) || 0,
    height: Number(entry.height ?? 0) || 0,
    likes: Number(entry.likes ?? 0) || 0,
    sourceUrl: String(entry.source_url ?? ''),
  }))
}
