extends SceneTree

# M0 截图像素审计：地面真值判定（Haven 教训：视觉模型会误读，像素审计优先）
const BASE := "C:/Users/Administrator/AppData/Roaming/Godot/app_userdata/kairo/m0/"

func _count_color(img: Image, x0: int, y0: int, x1: int, y1: int, target: Color, tol: int) -> int:
	var hits := 0
	for y in range(y0, y1):
		for x in range(x0, x1):
			var c := img.get_pixel(x, y)
			if abs(c.r8 - target.r8) <= tol and abs(c.g8 - target.g8) <= tol and abs(c.b8 - target.b8) <= tol:
				hits += 1
	return hits

func _count_pred(img: Image, x0: int, y0: int, x1: int, y1: int, pred: Callable) -> int:
	var hits := 0
	for y in range(y0, y1):
		for x in range(x0, x1):
			if pred.call(img.get_pixel(x, y)):
				hits += 1
	return hits

func _white(c: Color) -> bool: return c.r8 > 100 and c.g8 > 100 and c.b8 > 100 and abs(c.r8 - c.b8) < 40
func _dead_blue(c: Color) -> bool: return c.r8 < 40 and c.g8 < 70 and c.b8 > 95 and c.b8 < 135
func _bg_score(c: Color) -> bool: return abs(c.r8-0x14)<6 and abs(c.g8-0x16)<6 and abs(c.b8-0x1f)<6

func _init() -> void:
	var shirt := [Color("#d04040"), Color("#3a6ad0"), Color("#38a058"), Color("#d0a020"), Color("#9048c0"), Color("#30a8b0")]
	var s1 := Image.load_from_file(BASE + "shot1_walk_palette.png")
	var s2 := Image.load_from_file(BASE + "shot2_kill_feed.png")
	var s3 := Image.load_from_file(BASE + "shot3_cheer.png")
	print("size=", s1.get_size())

	# 图1：六套队色在走路带全部出现（调色板换装管线）
	for i in shirt.size():
		var hits := _count_color(s1, 0, 270, 720, 465, shirt[i], 12)
		print("palette[%d] walk-band hits=%d %s" % [i, hits, "PASS" if hits > 60 else "FAIL"])
	# 图1：小地图红/蓝点位
	print("minimap redA=%d %s" % [_count_color(s1, 0, 0, 720, 250, Color("#e05a5a"), 10), ""])
	print("minimap blueB=%d" % _count_color(s1, 0, 0, 720, 250, Color("#5a7ae0"), 10))
	# 图1：场馆木桌
	print("desks wood=%d" % _count_color(s1, 0, 680, 720, 1070, Color("#6b4a32"), 8))
	# 图1：A 排座位上方（y770-795）应无红衣（静止基线）
	print("s1 red-above-Arow=%d (expect 0)" % _count_color(s1, 100, 770, 320, 795, Color("#d04040"), 12))

	# 图2：击杀播报文字（白像素）
	print("banner white=%d %s" % [_count_pred(s2, 0, 555, 720, 625, _white), "PASS" if _count_pred(s2, 0, 555, 720, 625, _white) > 80 else "FAIL"])
	# 图2：阵亡选手（压暗蓝衣）在 B 排区域
	var dead := _count_pred(s2, 420, 930, 620, 1070, _dead_blue)
	print("dead chibi dim-blue=%d %s" % [dead, "PASS" if dead > 80 else "FAIL"])

	# 图3：庆祝跳跃——A 排上方出现红衣
	var cheer := _count_color(s3, 100, 770, 320, 795, Color("#d04040"), 12)
	print("cheer jump red-above-Arow=%d %s" % [cheer, "PASS" if cheer > 40 else "FAIL"])

	# 上下翻转探针：战绩板底色 #14161f 应在下半屏
	var top := _count_pred(s1, 0, 0, 720, 640, _bg_score)
	var bot := _count_pred(s1, 0, 640, 720, 1280, _bg_score)
	print("scoreboard-bg top-half=%d bottom-half=%d (bottom should dominate)" % [top, bot])
	quit(0)
