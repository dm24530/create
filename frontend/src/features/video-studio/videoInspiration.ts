// 灵感库模板：完整提示词 + 镜头思路 + 推荐参数，一键带入工作台。
// 参数（时长/画幅/分辨率/参考素材）与工作台的请求字段一一对应。
// 在线灵感见 videoArchiveApi.ts（由服务端拉取并代理媒体）。

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
  // 示例分镜图（来自 Nbility Gen 的模板库），没有时前端退回色板底图。
  storyboard?: string
}

export const VIDEO_INSPIRATION_TEMPLATES: VideoInspirationTemplate[] = [
  {
    slug: 'perfume-light-reveal',
    title: '香水瓶的光影揭幕',
    category: '产品广告',
    summary: '产品开场、品牌短片镜头练习。',
    prompt: '一只无品牌、无文字的透明方形香水瓶立在深灰色石台中央，瓶内是淡琥珀色液体。镜头从瓶身左前方缓慢向右移动，始终保持中近景；一条柔和的窄光带从左侧扫过玻璃边缘，显露瓶盖的金属质感和瓶内折射。背景保持深色，瓶身与石台固定不动。前两秒展示侧面轮廓，随后光线逐渐照亮正面，最后一秒停在干净、稳定的产品构图。真实商业摄影质感，克制的高光，无新增物体、字幕或场景切换。',
    tips: '若瓶身变形，减少横向移动，改成轻微推进；若出现标识，进一步简化瓶体描述。',
    checkpoints: '瓶形是否稳定、光线移动是否连续、透明材质是否自然。',
    durationSeconds: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 210,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/perfume-light-reveal.webp',
  },
  {
    slug: 'sneaker-material-study',
    title: '跑鞋材质特写',
    category: '产品广告',
    summary: '竖屏商品展示、材质质感练习。',
    prompt: '一只无品牌白色跑鞋放在低矮的石灰色展示台上，鞋侧有细密的织物纹理，鞋底是清晰的橡胶结构。竖屏构图，鞋子完整保留在画面内。镜头从鞋头位置缓慢向鞋侧移动，运动幅度小，展示鞋面的纤维和鞋底边缘；鞋子本身不旋转、不弯折。柔和侧光让纹理有层次，背景是均匀的浅灰摄影棚。整段保持同一只鞋、同一个镜头，末尾停稳，不出现文字、商标或额外的鞋。',
    tips: '若细节漂移，减小运镜并缩短为 4–5 秒；要求准确商品外观时使用模板 10。',
    checkpoints: '鞋带、鞋底和主体轮廓是否连续；竖屏是否裁掉主体。',
    durationSeconds: 5,
    aspectRatio: '9:16',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 210,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/sneaker-material-study.webp',
  },
  {
    slug: 'morning-coffee-pour',
    title: '清晨的一杯咖啡',
    category: '美食饮品',
    summary: '餐饮社媒、美食短片。',
    prompt: '清晨窗边的木桌上，一只白色陶瓷杯中装着黑咖啡，暖阳从画面左侧照进来。固定的微距中近景，镜头只做非常缓慢的推进。细细一股牛奶从画面上方倒入咖啡中央，浅色纹路缓慢扩散，形成自然流动的旋涡；少量热气向上飘起。前两秒只有咖啡和轻微热气，中间四秒缓慢倒入牛奶，最后两秒液面逐渐平静。杯口保持圆润稳定，桌面干净，浅景深，不出现手、文字、快速剪辑或夸张飞溅。',
    tips: '若倒液复杂，先只生成咖啡热气，再测试加入牛奶的版本。',
    checkpoints: '液体是否符合运动直觉，杯口是否变形，时间顺序是否大体符合描述。',
    durationSeconds: 8,
    aspectRatio: '9:16',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 28,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/morning-coffee-pour.webp',
  },
  {
    slug: 'mountain-cloud-dolly',
    title: '云海中的山脊',
    category: '自然风景',
    summary: '旅行、自然风景、横幅展示。',
    prompt: '日出前后的高山山脊，近处深色岩石清晰，远处层层山峰被低处云海包围。一个连续的航拍感镜头沿山脊缓慢向前移动，高度保持稳定；云层在山谷中轻轻流动，太阳从画面右侧带来柔和金色侧光。保持地形和山峰轮廓连贯，远景有真实的大气透视。前景岩石逐渐从画面下方掠过，最后停留在开阔的群山构图。自然纪录片质感，不出现建筑、人物、文字、突然加速或昼夜切换。',
    tips: '若地形漂移，改成固定机位、仅云海缓慢流动。',
    checkpoints: '地形稳定、前后景视差、云的运动是否自然。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 195,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/mountain-cloud-dolly.webp',
  },
  {
    slug: 'rainy-street-tracking',
    title: '雨夜街头跟拍',
    category: '人物与运镜',
    summary: '人物叙事、电影感运镜。',
    prompt: '夜晚刚下过雨的安静街道，一位穿深色外套、撑透明雨伞的成年行人从左向右缓慢走过。镜头在行人侧后方以同样速度平稳跟随，保持半身到全身之间的中景，人物只沿一个方向行走。潮湿路面反射远处店面的柔和暖光，雨滴细小，背景灯光虚化，不出现可辨认的店名。人物步伐自然、伞和外套保持连续，整段为一个稳定跟拍镜头，不切换场景、不突然回头、不加入其他近景人物或字幕。',
    tips: '若肢体不稳定，改成胸部以上的中景和更慢的步伐。',
    checkpoints: '行走是否自然、雨伞结构是否稳定、镜头与人物速度是否匹配。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 22,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/rainy-street-tracking.webp',
  },
  {
    slug: 'courtyard-approach',
    title: '穿过庭院的镜头',
    category: '建筑空间',
    summary: '建筑展示、空间氛围。',
    prompt: '一座现代混凝土庭院，中央有浅水池，左侧是竹子，正前方是宽敞的玻璃门。清晨的漫射光，空间安静，没有人物。镜头从庭院入口以人眼高度缓慢向前推进，沿笔直路线靠近水池，停在水池之前；不穿过门或墙体。水面只有细微波纹，竹叶轻轻摆动。建筑的垂直线、门窗数量、池边形状始终一致，宽幅建筑摄影构图，真实材质，不改变天气、不增加家具或文字。',
    tips: '若空间结构变化，使用固定机位；有实际建筑图时采用模板 12。',
    checkpoints: '直线、门窗数量、镜头是否穿模。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 45,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/courtyard-approach.webp',
  },
  {
    slug: 'clay-fox-starlight',
    title: '小狐狸发现星光',
    category: '动画短片',
    summary: '风格动画、简短叙事。',
    prompt: '手工黏土动画风格，一只圆润的橙色小狐狸站在深蓝色微型森林里，身旁有一片低矮草地。固定中景，保持同一角色和同一场景。前两秒小狐狸好奇地低头；随后草地上一个小小的暖黄色光点慢慢升起，小狐狸抬头看着它，耳朵轻轻动一下；光点在狐狸鼻尖前停留，最后狐狸露出轻微微笑。动作简单且有停顿，保留黏土材质的柔软颗粒感和温暖侧光，不加入其他角色、对白文字或突然的镜头切换。',
    tips: '若动作过多，去掉微笑或耳朵动作，仅保留抬头跟随光点。',
    checkpoints: '角色造型连续、动作顺序、黏土风格是否一致。',
    durationSeconds: 10,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 235,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/clay-fox-starlight.webp',
  },
  {
    slug: 'paper-boat-voyage',
    title: '纸船的微型航行',
    category: '定格风格',
    summary: '社媒循环片段、定格质感练习。',
    prompt: '俯拍一个方形手工纸艺场景：蓝色折纸波浪铺满桌面，一只白色小纸船位于画面左侧。镜头保持完全固定。纸船以轻微的定格动画节奏缓缓向右航行，周围纸质波浪依次小幅起伏；背景边缘有几朵静止的白色纸云。整段保持可见的纸张纤维、折痕和柔和桌面阴影，纸船形状稳定，最后在画面右侧停下。干净的正方形构图，不出现手、真实海水、文字或场景变换。',
    tips: '若变成真实海面，加强“全部由纸张组成”的描述。首版不承诺无缝循环。',
    checkpoints: '纸艺材质、船的形状、运动连续性。',
    durationSeconds: 8,
    aspectRatio: '1:1',
    resolution: '720p',
    requiresImages: 0,
    requiresVideo: false,
    requiresAudio: false,
    hue: 168,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/paper-boat-voyage.webp',
  },
  {
    slug: 'portrait-subtle-motion',
    title: '让肖像自然动起来',
    category: '图片转视频',
    summary: '人像展示、轻微动作测试。',
    prompt: '以 Image 1 中的成年人物、服装、背景和光线为参考，保持人物身份特征与原始画面风格。固定的半身镜头，人物先自然看向镜头，然后轻轻眨眼一次，嘴角出现很轻微的微笑，头部只做极小幅度调整。头发随微风轻动，衣服和背景基本不动。动作舒缓克制，保持五官位置、发型、饰品和服装细节连续；整段不说话、不明显转头、不改变构图，也不添加字幕或新的物体。',
    tips: '如身份变化明显，只保留眨眼，进一步减少头部动作。',
    checkpoints: '五官与身份连续性、眨眼、饰品漂移。',
    durationSeconds: 5,
    aspectRatio: '9:16',
    resolution: '720p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 15,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/portrait-subtle-motion.webp',
  },
  {
    slug: 'product-photo-orbit',
    title: '商品图变成展示镜头',
    category: '产品广告',
    summary: '将现有生图或产品照片变成短视频。',
    prompt: '以 Image 1 中的商品为唯一主体，保持它的外形、材质、颜色和已有图案。商品固定放在原有台面上，镜头从正面向右侧做一个非常小幅度的弧形移动，同时略微推进，始终让商品完整留在画面中。柔和侧光逐渐显露表面纹理和边缘高光，背景保持简洁、稳定。整个镜头缓慢、连续，最后半秒停稳。不要让商品旋转、拆解或变形，不增加附件，不修改已有标识，不出现新的文字或场景切换。',
    tips: '若涉及细小文字或精确标识，使用固定机位和光线变化，减少新视角。不能保证所有标识准确。',
    checkpoints: '与原图的形状一致性、标识漂移、视角变化是否合理。',
    durationSeconds: 5,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 210,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/product-photo-orbit.webp',
  },
  {
    slug: 'dish-steam-closeup',
    title: '菜品的诱人瞬间',
    category: '美食饮品',
    summary: '菜品照片、餐饮宣传。',
    prompt: '以 Image 1 的菜品、餐具和摆盘为参考，保留所有主要食材的位置与颜色。镜头以非常缓慢的速度向菜品推进，前景清晰，背景柔和虚化。菜品上方升起少量自然、轻薄的热气，表面有细微的油光变化，餐盘和桌面保持静止。保持真实美食摄影质感与原有光线方向。不要增加餐具、手或新的配菜，不让食物变形、沸腾或突然移动，不添加文字，整段不切镜头。',
    tips: '如果主体改变，固定镜头，仅保留很少的热气。',
    checkpoints: '食材是否保持、热气是否过量、景深是否稳定。',
    durationSeconds: 5,
    aspectRatio: '9:16',
    resolution: '720p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 28,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/dish-steam-closeup.webp',
  },
  {
    slug: 'interior-gentle-parallax',
    title: '室内空间微运镜',
    category: '建筑空间',
    summary: '室内设计、房产空间展示。',
    prompt: '以 Image 1 的室内空间为参考，严格保留墙体、门窗、家具和装饰的位置关系。镜头以人眼高度向右平移一小段距离，移动缓慢而稳定，产生轻微的前后景视差，不转向其他房间。窗外光线保持一致，若画面中有窗帘，只做非常轻微的自然摆动。建筑直线保持笔直，家具大小与数量不变。画面真实、安静，不增加人物，不开关门窗，不穿过任何物体，不出现文字或场景跳切。',
    tips: '若缺少新视角信息造成变形，改成轻微推进而非横移。',
    checkpoints: '建筑线条、家具数量、遮挡与视差。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 45,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/interior-gentle-parallax.webp',
  },
  {
    slug: 'illustration-character-motion',
    title: '插画里的角色苏醒',
    category: '插画动画',
    summary: '现有插画角色动画化。',
    prompt: '沿用 Image 1 的动物角色、线条、配色和绘画材质，保持原本的二维插画风格。镜头完全固定，角色先轻轻眨眼，再小幅抬起头，看向画面上方，最后恢复自然的静止姿态。身体与背景基本不动，只有眼睛、头部和耳朵做细微而协调的动作。保留原有轮廓粗细、阴影方式和画面构图，不转成写实或三维风格，不增加身体部位、文字、其他角色或镜头切换。',
    tips: '先只测试眨眼，再逐步加动作；尾部能否接回开头需实际剪辑验证。',
    checkpoints: '画风是否保持、轮廓是否闪烁、动作是否过大。',
    durationSeconds: 5,
    aspectRatio: '1:1',
    resolution: '720p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: false,
    hue: 280,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/illustration-character-motion.webp',
  },
  {
    slug: 'character-into-scene',
    title: '角色走进新场景',
    category: '多图参考',
    summary: '角色与场景组合、多图参考入门。',
    prompt: '使用 Image 1 的角色外形、服装和配色，将其放入 Image 2 的公园小路场景。角色以自然比例站在小路中景，光线与场景中的黄昏方向一致。角色缓慢向镜头走两三步，然后停下，轻轻看向旁边的树木。镜头在固定位置做极缓慢的推进，保持同一构图和场景。保留角色身份、服装细节和背景结构，使脚步与地面接触自然，不添加其他角色、字幕或新的场景，不突然改变角色的大小。',
    tips: '若走路不稳定，角色原地站立，仅转动视线；先统一两图画风。',
    checkpoints: '两种参考的融合、光线、脚与地面接触、角色尺度。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 2,
    requiresVideo: false,
    requiresAudio: false,
    hue: 128,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/character-into-scene.webp',
  },
  {
    slug: 'product-scene-lighting',
    title: '商品、场景与光线组合',
    category: '多图参考',
    summary: '三张图片分别约束商品、环境、视觉气氛。',
    prompt: '以 Image 1 的商品为主体，保留其外形、材质、颜色与已有标识；采用 Image 2 的展示环境和台面布局；仅参考 Image 3 的光线方向、明暗层次和整体色调，不复制其中的其他物体。商品位于画面中央偏下，放置稳定。镜头从略远的中景缓慢推进到商品近景，背景逐渐柔和虚化，侧面高光轻微变化。整段是一个连续的商业展示镜头，不改变商品结构，不增加文字、附件或第二个商品，不切换场景。',
    tips: '若参考冲突，先用图片 1–2 生成，确认主体后再加入光线参考。',
    checkpoints: '三张图片是否各司其职、是否把第三张主体误复制进来、商品细节。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 3,
    requiresVideo: false,
    requiresAudio: false,
    hue: 128,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/product-scene-lighting.webp',
  },
  {
    slug: 'reference-camera-motion',
    title: '借用参考镜头的运动',
    category: '视频参考',
    summary: '从自己的视频里参考运镜节奏。',
    prompt: '以 Image 1 的主体、材质与颜色作为画面内容，参考所上传视频的镜头运动方向、速度变化和停顿节奏。只借鉴参考视频的运镜，不复制其中的人物、商品、背景或文字。主体在一个简洁、稳定的摄影棚场景里保持不动；镜头缓慢靠近主体，运动轻柔，末尾自然减速并停稳。保持主体形状和画面光线一致，不添加快速旋转、突然变焦、场景切换或新的文字。优先保留 Image 1 的视觉身份。',
    tips: '选用更短、更简单的参考片段。此模板不表示 API 有精确运动轨迹控制功能。',
    checkpoints: '是否体现参考运镜、主体是否被参考视频内容污染、结束是否稳定。',
    durationSeconds: 8,
    aspectRatio: '16:9',
    resolution: '720p',
    requiresImages: 1,
    requiresVideo: true,
    requiresAudio: false,
    hue: 200,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/reference-camera-motion.webp',
  },
  {
    slug: 'music-led-abstract-motion',
    title: '让画面跟随音乐节奏',
    category: '音频参考',
    summary: '抽象视觉、音乐氛围短片。',
    prompt: '以 Image 1 的几何形状、色彩和材质为视觉基础，参考所上传音频的节奏与强弱变化，生成一段克制的抽象动态图像。镜头保持固定，画面中央的形状随节拍轻微扩张、收缩，柔和光线在音量增强时略微变亮，在平缓段落中恢复安静。动作连贯、有呼吸感，保留原有构图，不出现频闪、快速切镜、突兀的形状替换或文字。结尾逐渐收束到稳定画面，视觉节奏以参考音频为引导。',
    tips: '减少形状数量，用“一个物体缓慢呼吸”先验证关联。',
    checkpoints: '节奏关联、亮度是否舒适、图形是否连续。',
    durationSeconds: 10,
    aspectRatio: '9:16',
    resolution: '720p',
    requiresImages: 1,
    requiresVideo: false,
    requiresAudio: true,
    hue: 320,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/music-led-abstract-motion.webp',
  },
  {
    slug: 'multimodal-product-film',
    title: '完整多模态创意配方',
    category: '综合参考',
    summary: '展示商品、场景、气氛、运镜、节奏的联合参考。',
    prompt: '以 Image 1 的商品为唯一主角，保持商品的形状、颜色、材质和已有标识。采用 Image 2 的空间和台面，参考 Image 3 的柔和侧光与低饱和色调。镜头运动参考上传视频的缓慢横移方向和减速方式，整体节奏参考上传音频的平缓起伏，不复制参考视频里的其他物体。前四秒用中景建立场景，中间五秒缓慢横移并略微靠近商品，最后三秒减速停在清晰的商品构图。整个过程保持一个连续镜头，商品固定、背景稳定、光线自然，不新增文案、物体或场景跳切。',
    tips: '先单独完成商品加场景，再依次加入光线、视频和音频，记录每个输入产生的变化。',
    checkpoints: '主体优先级、场景稳定、运动与节奏、费用是否准确展示。',
    durationSeconds: 12,
    aspectRatio: '16:9',
    resolution: '1080p',
    requiresImages: 3,
    requiresVideo: true,
    requiresAudio: true,
    hue: 255,
    storyboard: 'https://gen.nbility.ai/media/video-storyboards/multimodal-product-film.webp',
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

