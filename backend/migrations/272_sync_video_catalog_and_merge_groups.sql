-- Sync the current video catalog and its display guidance from momoapi pricing.
-- Source prices are CNY reference prices embedded in descriptions only; they do not
-- change USD billing fields. Actual billing prices remain administrator-configured.
--
-- Also merge the legacy "seedance 视频" group into the current "视频" group when both exist.
DO $migration$
DECLARE
    target_channel_id bigint;
    current_video_group_id bigint;
    legacy_video_group_id bigint;
    entry jsonb;
    catalog_json jsonb := $catalog$[
  {
    "model_name": "seedance 2.0 mini-GT",
    "billing_mode": "per_request",
    "description": "Seedance 2.0 mini-GT（官方链路）：参考视频和成片的秒数一起计费，提交时先按最长参考视频预扣，出片后多退少补。参考图、参考音频不加价；支持写实人物；生成失败全额退款。调用：POST /v1/videos，model、prompt 必填；seconds 只支持 10 或 15；resolution 为 480p 或 720p；ratio 支持 adaptive / 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。参考素材传公网 HTTPS 链接：input_reference（首帧）、image / images[]（参考图）、video / videos[]（参考视频），或 content[]：{type: image_url|video_url|audio_url, <type>: {url}, role: first_frame|last_frame|reference_image|reference_video|reference_audio}；本地文件先 POST /v1/uploads 换链接。图片最多 9 张（单张 ≤30MB），参考视频最多 3 段合计 2–15 秒，音频最多 3 段每段 2–15 秒；首尾帧与 reference_image 不能混用。可选 seed、generate_audio、watermark、return_last_frame。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：480p 10s ¥0.92/次；480p 15s ¥1.38/次；720p 10s ¥1.98/次；720p 15s ¥2.97/次。 生成能力：文生视频、参考图、参考视频。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。 参考素材：参考图 9 张，参考视频 3 段，参考音频 3 段。"
  },
  {
    "model_name": "seedance-2.5-flash-zq",
    "billing_mode": "video",
    "description": "10图5音频5视频，480p、720p。4~30秒 [\"9:16\",\"16:9\",\"1:1\",\"3:4\",\"4:3\"]\n\n参考视频按上游规则另行计费。 上游参考价（人民币）：480p ¥0.15/秒；720p ¥0.38/秒。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4。 参考素材：参考图 10 张，参考视频 5 段，参考音频 5 段。"
  },
  {
    "model_name": "muse-cheap",
    "billing_mode": "per_request",
    "description": "muse-cheap 视频生成（Muse，720p，有声）。按次计费：1–10 秒，20 秒，30 秒；POST /v1/videos，model、prompt 必填；seconds 可选 1–10 的整数、20 或 30（20 / 30 秒直出连贯长视频）；ratio 为 16:9（默认）或 9:16，也可传 size 1280x720 / 720x1280。参考图用 image_urls（最多 7 张），必须是公网 HTTPS 链接，本地图片可先通过 POST /v1/uploads 托管；暂不支持参考视频、参考音频和首尾帧。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：720p 1s ¥0.92/次；720p 10s ¥0.92/次；720p 2s ¥0.92/次；720p 20s ¥1.49/次；720p 3s ¥0.92/次；720p 30s ¥1.72/次；720p 4s ¥0.92/次；720p 5s ¥0.92/次；720p 6s ¥0.92/次；720p 7s ¥0.92/次；720p 8s ¥0.92/次；720p 9s ¥0.92/次。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16。 参考素材：参考图 7 张。"
  },
  {
    "model_name": "seedance-2.0-mini-Chovy",
    "billing_mode": "per_request",
    "description": "seedance-2.0-mini-Chovy 视频生成；时长 只支持 5 / 10 / 15 秒；清晰度 固定720p；比例 支持9:16、16:9；最多9张公网HTTP(S)参考图，可先POST /v1/uploads上传。不支持参考音频、参考视频和首尾帧；GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content取片。\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：720p 10s ¥1.5/次；720p 15s ¥1.5/次；720p 5s ¥1.5/次。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16。 参考素材：参考图 9 张。"
  },
  {
    "model_name": "wan3.0-video",
    "billing_mode": "video",
    "description": "wan3.0-video模型，10图5音频0视频，480p、720p、1080p，2~30秒。\n\n上游参考价（人民币）：1080p ¥1.52/秒；480p ¥0.42/秒；720p ¥0.8/秒。"
  },
  {
    "model_name": "wan3.0-yuanlian",
    "billing_mode": "video",
    "description": "wan3.0模型，10图5音频5视频，480p、720p、1080p，2~30秒。视频结果返回的是官方链接\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、参考图、参考视频。 参考素材：参考图 10 张，参考视频 5 段，参考音频 5 段。"
  },
  {
    "model_name": "seedance 2.5-GT",
    "billing_mode": "video",
    "description": "Seedance 2.5 GT，参考图和音频不加价，不额外计输入视频秒数。4–30秒整数，默认5秒、480p；支持480p/720p/1080p。支持30张参考图、10段参考视频、10段参考音频，合计最多50项，也支持纯音频参考；参考视频单段2–15秒、合计不超过15秒，参考音频单段2–30秒、合计不超过30秒。画幅16:9/4:3/1:1/3:4/9:16/21:9/adaptive；generate_audio可开关，默认开启。参考素材均用公网HTTPS链接，本地素材先POST /v1/uploads托管。watermark、return_last_frame布尔选项和output_format=mp4/mov可传；网关目前只提供视频下载，不承诺尾帧独立下载。POST /v1/videos，model精确填写seedance 2.5-GT；GET /v1/videos/{task_id}查询，GET /v1/videos/{task_id}/content下载。\n\n参考视频按上游规则另行计费。 上游参考价（人民币）：1080p ¥2.5/秒；480p ¥0.59/秒；720p ¥1.11/秒。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。 参考素材：参考图 30 张，参考视频 10 段，参考音频 10 段。"
  },
  {
    "model_name": "seedance2.5 coke",
    "billing_mode": "per_request",
    "description": "Seedance 2.5 coke 视频生成，支持真人参考图；720p；时长 为 5–30 的整数；比例 支持 16:9、9:16、4:3、3:4、1:1；参考图最多 30 张；参考视频最多 10 个；参考音频最多 10 段。参考素材必须是公网可直接下载的 http(s) 链接，本地文件可先 POST /v1/uploads 换成链接。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：720p ¥8.05/次。 生成能力：文生视频、参考图、参考视频。 画幅：16:9 / 9:16 / 4:3 / 3:4 / 1:1。 参考素材：参考图 30 张，参考视频 10 段，参考音频 10 段。"
  },
  {
    "model_name": "seedance2.0 fast Deneb",
    "billing_mode": "per_request",
    "description": "Seedance 2.0 Fast Deneb 视频生成；5 / 10 / 15 秒同价；POST /v1/videos；时长 为 5、10 或 15；清晰度固定 720p；比例 支持 16:9 / 9:16 / 1:1 / 4:3 / 3:4；成片带声音。参考图最多 9 张，须为公网可直接下载的 http(s) 链接（本地文件可先 POST /v1/uploads 换成链接），也可以直接传 base64 图片（data:image/png;base64,…）。不支持参考音频和参考视频。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：720p 10s ¥1.38/次；720p 15s ¥1.38/次；720p 5s ¥1.38/次。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4。 参考素材：参考图 9 张。"
  },
  {
    "model_name": "seedance2.0 mini Love",
    "billing_mode": "video",
    "description": "4–15 秒任选（不传按 5 秒）、480p / 720p（不传按 720p）。注意：画面可能会烧台词字幕（提示词写了不要也可能出现）。model、prompt 必填；seconds 为 4–15 的整数；resolution 为 480p 或 720p；ratio 支持 adaptive / 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。参考图和参考音频：图片最多 9 张、单张 ≤30MB，音频最多 3 段、每段 2–15 秒；首尾帧与 reference_image 不能混用；素材用公网 HTTPS 链接，本地文件可先 POST /v1/uploads 换链接。不支持参考视频（传了直接报错、不扣费）。可选 seed、generate_audio、watermark、camera_fixed、return_last_frame。\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、首尾帧、参考图。 画幅：16:9 / 9:16:1:1 / 4:3 / 3:4 / 21:9。 参考素材：参考图 9 张，参考音频 3 段。"
  },
  {
    "model_name": "grok-imagine-video-1.5",
    "billing_mode": "video",
    "description": "Video model for image-to-video generation, editing, and extension workflows\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、图生视频、首尾帧、参考图。 参考素材：参考图 7 张。"
  },
  {
    "model_name": "seedance-2.0-fast",
    "billing_mode": "video",
    "description": "seedance2.0 -fast支持480p/720p，9图3视频3音频，不卡人脸，5~15秒，尺寸：\"9:16\",\"16:9\",\"1:1\",\"3:4\",\"4:3\";参考图用reference_image_urls；参考视频用reference video_urls；参考音频用reference_audio_urls\n\n上传或不传参考视频，价格相同。 参考素材：参考图 9 张，参考视频 1 段，参考音频 10 段。"
  },
  {
    "model_name": "muse-video",
    "billing_mode": "video",
    "description": "支持文生视频与图生视频，1–60 秒，成片带音轨。image 为首帧；可再加 reference_images，总共最多 4 张，第一张作为起始画面，其余作主体、场景、风格参考。分辨率不可指定。 resolution 参数会被忽略，默认720p，横屏为 1280×720，竖屏为 720×1280。aspect_ratio：16:9（默认）或 9:16。image首帧：{\"url\": \"https://...\"}，url必须用公网可访问链接。\nreference_images参考图 [{\"url\": \"...\"}]；与 image 合计最多 4 张，单张 ≤10 MiB\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：720p ¥0.4/次。 生成能力：文生视频、图生视频、参考图。 画幅：16:9 / 9:16。 参考素材：参考图 4 张。"
  },
  {
    "model_name": "seedance 2.0 fast-GT",
    "billing_mode": "per_request",
    "description": "Seedance 2.0 fast-GT（官方链路）：只做 10 秒和 15 秒。支持写实人物；时长 只支持 10 或 15；清晰度 为 480p 或 720p；比例 支持 adaptive / 16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。参考素材传公网 HTTPS 链接：（首帧）、（参考图）、（参考视频）本地文件先 POST /v1/uploads 换链接。图片最多 9 张（单张 ≤30MB），参考视频最多 3 段合计 2–15 秒，音频最多 3 段每段 2–15 秒；首尾帧与 参考图 不能混用。可选 seed、generate_audio、watermark、return_last_frame。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。成片完成后，查询结果另带 source_video_url（成片原始链接，可直接下载）：签名 24 小时有效，最后 1 小时不再提供；\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：480p 10s ¥2.05/次；480p 15s ¥3.06/次；720p 10s ¥4.41/次；720p 15s ¥6.61/次。 生成能力：文生视频、参考图、参考视频。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。 参考素材：参考图 9 张，参考视频 3 段，参考音频 3 段。"
  },
  {
    "model_name": "seedance-2.5-alioth",
    "billing_mode": "video",
    "description": "Seedance 2.5 Alioth 720p；POST /v1/videos；时长 为 4–30 的整数；清晰度固定 720p；比例 支持 16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9；成片带声音。参考图最多 30 张；参考音频最多 10 段；须为公网可直接下载的 http(s) 链接，本地文件可先 POST /v1/uploads 换成链接。不支持参考视频和首尾帧，其余字段（如 duration、size、seed）不要传，会被直接拒绝（不扣费）。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。 参考素材：参考图 30 张，参考音频 10 段。"
  },
  {
    "model_name": "minimax H3-self",
    "billing_mode": "video",
    "description": "MiniMax H3 自部署视频生成；1–15 秒，480p/768p 横竖；支持最多 9 张参考图（ref_image_0–8）和 3 段参考音频（ref_audio_0–2），可用 URL、Base64 或 multipart 文件引用；prompt 必填。\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、参考图。 参考素材：参考图 9 张，参考音频 3 段。"
  },
  {
    "model_name": "seedance-2.5-merak",
    "billing_mode": "per_request",
    "description": "POST /v1/videos；时长为 4–30 的整数；分辨率为 720p 或 480p；比例 支持 16:9 / 9:16 / 4:3 / 3:4 / 1:1 / 21:9；成片带声音。参考图最多 10 张；参考音频最多 5 段（WAV 或 MP3）；须为公网可直接下载的 http(s) 链接，本地文件可先 POST /v1/uploads 换成链接。不支持参考视频和首尾帧，其余字段（如 duration、size、seed）不要传，会被直接拒绝（不扣费）。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 上游参考价（人民币）：480p ¥7.25/次；720p ¥7.25/次。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9。 参考素材：参考图 10 张，参考音频 5 段。"
  },
  {
    "model_name": "grok-imagine-video",
    "billing_mode": "video",
    "description": "Image model for prompt-driven generation, editing, and visual design workflows\n\n上传或不传参考视频，价格相同。"
  },
  {
    "model_name": "seedance-2.0",
    "billing_mode": "video",
    "description": "seedance2.0 支持480p/720p，9图3视频3音频，不卡人脸，5~15秒，尺寸：\"9:16\",\"16:9\",\"1:1\",\"3:4\",\"4:3\";参考图用reference_image_urls；参考视频用reference video_urls；参考音频用reference_audio_urls\n\n上传或不传参考视频，价格相同。 参考素材：参考图 9 张，参考视频 1 段，参考音频 10 段。"
  },
  {
    "model_name": "minimax H3",
    "billing_mode": "video",
    "description": "minimax H3 视频生成（480P，有声）；参考图前 5 张免费，第 6–9 张每张加收 ¥0.18；POST /v1/videos，model、prompt 必填；seconds 为 4–15 的整数；resolution 固定 480P；ratio 支持 9:16 / 16:9 / 1:1 / 3:4 / 4:3 / 2:3 / 3:2 / 21:9（不传按 9:16，输出 480×864）。可纯文字生成，也可带参考图：image_urls 最多 9 张，必须是公网 HTTPS 链接，本地图片可先通过 POST /v1/uploads 托管；不支持参考视频、参考音频和首尾帧（传了直接报错、不扣费）。GET /v1/videos/{task_id} 查询，GET /v1/videos/{task_id}/content 下载。\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、参考图。 画幅：9:16 / 16:9 / 1:1 / 3:4 / 4:3 / 2:3 / 3:2 / 21:9。 参考素材：参考图 9 张。"
  },
  {
    "model_name": "seedance-2.0-mini",
    "billing_mode": "video",
    "description": "seedance2.0 -mini 支持480p/720p，9图3视频3音频，不卡人脸，5~15秒，尺寸：\"9:16\",\"16:9\",\"1:1\",\"3:4\",\"4:3\";参考图用reference_image_urls；参考视频用reference video_urls；参考音频用reference_audio_urls\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、参考视频、参考图。 画幅：9:16 / 16:9 / 1:1 / 3:4 / 4:3。 参考素材：参考图 9 张，参考视频 3 段，参考音频 3 段。"
  },
  {
    "model_name": "seedance-2.5-draft-zq",
    "billing_mode": "video",
    "description": "30图10音频10视频，4~30秒，480p [\"9:16\",\"16:9\",\"1:1\",\"3:4\",\"4:3\"]\n\n参考视频按上游规则另行计费。 上游参考价（人民币）：480p ¥0.18/秒。 生成能力：文生视频、参考图。 画幅：16:9 / 9:16 / 1:1 / 4:3 / 3:4。 参考素材：参考图 30 张，参考视频 10 段，参考音频 10 段。"
  },
  {
    "model_name": "seedance-2.5",
    "billing_mode": "video",
    "description": "Seedance 2.5 支持480p/720p/1080p，30图10视频10音频，不卡人脸，5~30秒，尺寸：\"9:16\",\"16:9\",\"1:1\",\"3:4\",\"4:3\";参考图用reference_image_urls；参考视频用reference video_urls；参考音频用reference_audio_urls\n\n上传或不传参考视频，价格相同。 生成能力：文生视频、参考图、参考视频。 参考素材：参考图 30 张，参考视频 10 段，参考音频 10 段。"
  }
]$catalog$::jsonb;
BEGIN
    SELECT id INTO target_channel_id
    FROM channels
    WHERE name = '视频' AND status = 'active'
    ORDER BY id
    LIMIT 1;

    IF target_channel_id IS NULL THEN
        RETURN;
    END IF;

    SELECT id INTO current_video_group_id
    FROM groups
    WHERE name = '视频' AND status = 'active' AND deleted_at IS NULL
    ORDER BY id DESC
    LIMIT 1;

    SELECT id INTO legacy_video_group_id
    FROM groups
    WHERE name = 'seedance 视频' AND deleted_at IS NULL
    ORDER BY id DESC
    LIMIT 1;

    IF current_video_group_id IS NOT NULL
       AND legacy_video_group_id IS NOT NULL
       AND current_video_group_id <> legacy_video_group_id THEN
        UPDATE api_keys
        SET group_id = current_video_group_id,
            updated_at = NOW()
        WHERE group_id = legacy_video_group_id;

        DELETE FROM channel_groups
        WHERE group_id = legacy_video_group_id;

        DELETE FROM account_groups
        WHERE group_id = legacy_video_group_id;

        UPDATE groups
        SET status = 'disabled',
            updated_at = NOW()
        WHERE id = legacy_video_group_id;
    END IF;

    FOR entry IN SELECT * FROM jsonb_array_elements(catalog_json)
    LOOP
        UPDATE channel_model_pricing p
        SET description = entry->>'description',
            updated_at = NOW()
        WHERE p.channel_id = target_channel_id
          AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(p.models) AS model_name
              WHERE lower(model_name) = lower(entry->>'model_name')
          );

        IF NOT FOUND THEN
            INSERT INTO channel_model_pricing (
                channel_id, platform, models, billing_mode, description, created_at, updated_at
            ) VALUES (
                target_channel_id,
                'openai',
                jsonb_build_array(entry->>'model_name'),
                entry->>'billing_mode',
                entry->>'description',
                NOW(),
                NOW()
            );
        END IF;
    END LOOP;
END
$migration$;
