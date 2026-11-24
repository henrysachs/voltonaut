from __future__ import annotations

import json
import math
import random
import struct
import zlib
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
ASSETS_DIR = ROOT / "apps" / "web" / "public" / "assets"
PREVIEWS_DIR = ROOT / "assets-src" / "previews"
MANIFEST_PATH = ROOT / "assets-src" / "manifest.json"
LICENSE = "CC0-1.0"

BIKE_BUDGET = 25_000
PINE_BUDGET = 2_000
ROCK_BUDGET = 1_000


def srgb_channel(value: int) -> float:
    channel = value / 255.0
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def color(hex_value: str) -> tuple[float, float, float, float]:
    return (
        srgb_channel(int(hex_value[0:2], 16)),
        srgb_channel(int(hex_value[2:4], 16)),
        srgb_channel(int(hex_value[4:6], 16)),
        1.0,
    )


def material(
    name: str,
    hex_value: str,
    *,
    metallic: float = 0.0,
    roughness: float = 0.55,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    if result.node_tree is None:
        result.use_nodes = True
    shader = result.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = color(hex_value)
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Roughness"].default_value = roughness
    return result


def empty(name: str, location=(0.0, 0.0, 0.0), parent=None):
    result = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(result)
    result.empty_display_type = "PLAIN_AXES"
    result.empty_display_size = 0.05
    result.location = location
    result.parent = parent
    return result


def finish_mesh(obj, name: str, mat, parent=None, *, smooth: bool = False):
    obj.name = name
    obj.data.name = name
    if mat is not None:
        obj.data.materials.append(mat)
    obj.parent = parent
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def custom_mesh(
    name: str,
    vertices,
    faces,
    mat,
    parent=None,
    *,
    smooth: bool = False,
):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    if mesh.validate(verbose=False):
        raise RuntimeError(f"{name}: invalid source mesh")
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish_mesh(obj, name, mat, parent, smooth=smooth)


def tube(
    name: str,
    start,
    end,
    radius: float,
    mat,
    parent=None,
    *,
    vertices: int = 8,
    caps: bool = True,
):
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=direction.length,
        end_fill_type="NGON" if caps else "NOTHING",
        location=(start_vector + end_vector) / 2.0,
    )
    obj = bpy.context.object
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return finish_mesh(obj, name, mat, parent)


def box(name: str, location, dimensions, mat, parent=None, *, rotation=None):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.object
    obj.scale = tuple(dimension / 2.0 for dimension in dimensions)
    if rotation is not None:
        obj.rotation_euler = rotation
    return finish_mesh(obj, name, mat, parent)


def torus(
    name: str,
    location,
    major_radius: float,
    minor_radius: float,
    mat,
    parent=None,
    *,
    major_segments: int = 32,
    minor_segments: int = 8,
):
    bpy.ops.mesh.primitive_torus_add(
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        major_radius=major_radius,
        minor_radius=minor_radius,
        rotation=(math.pi / 2.0, 0.0, 0.0),
    )
    return finish_mesh(bpy.context.object, name, mat, parent, smooth=True)


def gear(
    name: str,
    location,
    radius: float,
    depth: float,
    teeth: int,
    mat,
    parent=None,
):
    outline = []
    for tooth in range(teeth):
        for fraction, tooth_radius in ((0.0, radius * 0.91), (0.25, radius), (0.75, radius)):
            angle = 2.0 * math.pi * (tooth + fraction) / teeth
            outline.append((math.cos(angle) * tooth_radius, math.sin(angle) * tooth_radius))
    count = len(outline)
    vertices = []
    for side in (-1.0, 1.0):
        vertices.extend((x, side * depth / 2.0, z) for x, z in outline)
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, following + count, index + count))
    obj = custom_mesh(name, vertices, faces, mat, parent)
    obj.location = location
    return obj


def descendants(root):
    result = [root]
    for child in root.children:
        result.extend(descendants(child))
    return result


def select_assets(root):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root


def export_glb(root, filename: str):
    select_assets(root)
    bpy.ops.export_scene.gltf(
        filepath=str(ASSETS_DIR / filename),
        export_format="GLB",
        use_selection=True,
        export_animations=False,
        export_skins=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_materials="EXPORT",
        export_extras=True,
    )


def point_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)


def canonicalize_png(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"{path}: invalid PNG signature")
    offset = 8
    header = None
    srgb = None
    compressed_pixels = []
    while offset < len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        payload = data[offset + 8 : offset + 8 + length]
        if kind == b"IHDR":
            header = payload
        elif kind == b"sRGB":
            srgb = payload
        elif kind == b"IDAT":
            compressed_pixels.append(payload)
        offset += length + 12
    if header is None or not compressed_pixels:
        raise RuntimeError(f"{path}: incomplete PNG")
    pixels = zlib.decompress(b"".join(compressed_pixels))
    chunks = [png_chunk(b"IHDR", header)]
    if srgb is not None:
        chunks.append(png_chunk(b"sRGB", srgb))
    chunks.append(png_chunk(b"IDAT", zlib.compress(pixels, level=9)))
    chunks.append(png_chunk(b"IEND", b""))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"".join(chunks))


def add_preview_light(name, location, energy: float, size: float, target):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)
    return obj


def render_preview(root, filename: str, camera_location, camera_target, floor_size: float):
    bpy.ops.object.select_all(action="DESELECT")
    floor_mat = material("preview_floor", "303A43", roughness=0.92)
    bpy.ops.mesh.primitive_plane_add(size=floor_size, location=(0.0, 0.0, -0.008))
    finish_mesh(bpy.context.object, "preview_floor", floor_mat)

    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("preview_world")
        bpy.context.scene.world = world
    if world.node_tree is None:
        world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = color("778898")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45

    add_preview_light("preview_key", (2.5, -3.5, 5.5), 650.0, 4.0, camera_target)
    add_preview_light("preview_fill", (-3.0, -1.0, 2.8), 280.0, 3.0, camera_target)
    add_preview_light("preview_rim", (1.0, 4.0, 4.0), 520.0, 3.0, camera_target)

    camera_data = bpy.data.cameras.new("preview_camera")
    camera = bpy.data.objects.new("preview_camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = camera_location
    camera_data.lens = 52.0
    camera_data.sensor_width = 36.0
    point_at(camera, camera_target)
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 4
    scene.cycles.seed = 42
    scene.render.resolution_x = 960
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 30
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.render.filepath = str(PREVIEWS_DIR / filename)
    bpy.ops.render.render(write_still=True)
    canonicalize_png(PREVIEWS_DIR / filename)


def build_bike():
    paint = material("frame_paint", "16AFA4", metallic=0.25, roughness=0.3)
    accent = material("accent_yellow", "F2C94C", metallic=0.1, roughness=0.38)
    carbon = material("carbon", "202831", metallic=0.3, roughness=0.34)
    rubber = material("rubber", "11161B", roughness=0.82)
    metal = material("brushed_metal", "AAB7C2", metallic=0.85, roughness=0.28)
    leather = material("saddle_leather", "28242A", roughness=0.7)
    bottle_mat = material("bottle_shell", "E9F2F1", metallic=0.05, roughness=0.32)

    bike = empty("bike")
    frame = empty("frame", parent=bike)
    fork = empty("fork", parent=bike)
    front_anchor = empty("anchor_wheel_front", (0.57, 0.0, 0.35), bike)
    rear_anchor = empty("anchor_wheel_rear", (-0.55, 0.0, 0.35), bike)
    crank_anchor = empty("anchor_crank", (-0.08, 0.0, 0.28), bike)
    saddle_anchor = empty("anchor_saddle", (-0.255, 0.0, 0.91), bike)
    handlebar_anchor = empty("anchor_handlebar", (0.42, 0.0, 0.92), bike)
    front_wheel = empty("wheel_front", parent=front_anchor)
    rear_wheel = empty("wheel_rear", parent=rear_anchor)
    crank = empty("crank", parent=crank_anchor)
    saddle = empty("saddle", parent=saddle_anchor)
    handlebar = empty("handlebar", parent=handlebar_anchor)

    rear_axle = (-0.55, 0.0, 0.35)
    bottom_bracket = (-0.08, 0.0, 0.28)
    seat_top = (-0.24, 0.0, 0.82)
    head_lower = (0.38, 0.0, 0.72)
    head_upper = (0.31, 0.0, 0.85)

    tube("frame_top_tube", seat_top, head_upper, 0.024, paint, frame)
    tube("frame_down_tube", bottom_bracket, head_lower, 0.029, paint, frame)
    tube("frame_seat_tube", bottom_bracket, seat_top, 0.025, paint, frame)
    tube("frame_head_tube", head_lower, head_upper, 0.034, carbon, frame)
    tube("frame_seat_post", seat_top, (-0.255, 0.0, 0.91), 0.014, carbon, frame)
    for side in (-1.0, 1.0):
        tube(
            f"frame_chain_stay_{'left' if side > 0 else 'right'}",
            (bottom_bracket[0], side * 0.035, bottom_bracket[2]),
            (rear_axle[0], side * 0.045, rear_axle[2]),
            0.012,
            paint,
            frame,
        )
        tube(
            f"frame_seat_stay_{'left' if side > 0 else 'right'}",
            (seat_top[0], side * 0.018, seat_top[2] - 0.025),
            (rear_axle[0], side * 0.045, rear_axle[2]),
            0.010,
            paint,
            frame,
        )
    tube("frame_bottom_bracket", (-0.08, -0.05, 0.28), (-0.08, 0.05, 0.28), 0.041, carbon, frame)
    box("frame_head_badge", (0.369, 0.0, 0.785), (0.012, 0.025, 0.052), accent, frame, rotation=(0.0, -0.42, 0.0))

    tube("fork_crown", (0.385, -0.04, 0.705), (0.385, 0.04, 0.705), 0.021, carbon, fork)
    for side in (-1.0, 1.0):
        tube(
            f"fork_blade_{'left' if side > 0 else 'right'}",
            (0.385, side * 0.033, 0.705),
            (0.50, side * 0.043, 0.51),
            0.016,
            carbon,
            fork,
            vertices=8,
        )
        tube(
            f"fork_lower_{'left' if side > 0 else 'right'}",
            (0.50, side * 0.043, 0.51),
            (0.57, side * 0.045, 0.35),
            0.012,
            carbon,
            fork,
        )

    for label, wheel in (("front", front_wheel), ("rear", rear_wheel)):
        torus(f"{label}_tire", (0.0, 0.0, 0.0), 0.323, 0.027, rubber, wheel, minor_segments=8)
        torus(f"{label}_rim", (0.0, 0.0, 0.0), 0.298, 0.012, carbon, wheel, minor_segments=6)
        torus(f"{label}_rim_stripe", (0.0, -0.012, 0.0), 0.302, 0.003, accent, wheel, minor_segments=4)
        tube(f"{label}_hub", (0.0, -0.052, 0.0), (0.0, 0.052, 0.0), 0.019, metal, wheel, vertices=12)
        gear(f"{label}_brake_rotor", (0.0, 0.058, 0.0), 0.076, 0.004, 20, metal, wheel)
        for spoke in range(16):
            angle = 2.0 * math.pi * spoke / 16.0
            hub_side = 0.026 if spoke % 2 == 0 else -0.026
            tube(
                f"{label}_spoke_{spoke + 1:02d}",
                (math.cos(angle + 0.35) * 0.022, hub_side, math.sin(angle + 0.35) * 0.022),
                (math.cos(angle) * 0.292, 0.0, math.sin(angle) * 0.292),
                0.0016,
                metal,
                wheel,
                vertices=4,
                caps=False,
            )
        tube(f"{label}_valve", (0.0, 0.0, 0.283), (0.0, 0.0, 0.312), 0.003, metal, wheel, vertices=6)

    gear("crank_chainring", (0.0, -0.061, 0.0), 0.108, 0.008, 36, metal, crank)
    gear("crank_chainring_spider", (0.0, -0.057, 0.0), 0.064, 0.012, 5, carbon, crank)
    tube("crank_arm_right", (0.0, -0.075, 0.0), (0.06, -0.075, -0.15), 0.013, carbon, crank)
    tube("crank_arm_left", (0.0, 0.075, 0.0), (-0.06, 0.075, 0.15), 0.013, carbon, crank)
    pedal_left = empty("pedal_l", (-0.06, 0.17, 0.15), crank)
    pedal_right = empty("pedal_r", (0.06, -0.17, -0.15), crank)
    for label, pedal in (("left", pedal_left), ("right", pedal_right)):
        box(f"pedal_{label}_body", (0.0, 0.0, 0.0), (0.105, 0.085, 0.018), carbon, pedal)
        axle_inner = -0.095 if label == "left" else 0.095
        axle_outer = 0.04 if label == "left" else -0.04
        tube(f"pedal_{label}_axle", (0.0, axle_outer, 0.0), (0.0, axle_inner, 0.0), 0.005, metal, pedal, vertices=8)
        box(f"pedal_{label}_reflector", (0.0, -0.045 if label == "left" else 0.045, 0.0), (0.065, 0.005, 0.012), accent, pedal)

    gear("rear_cassette", (0.0, -0.062, 0.0), 0.052, 0.018, 16, metal, rear_wheel)
    tube("chain_upper", (-0.08, -0.069, 0.385), (-0.55, -0.069, 0.398), 0.003, metal, frame, vertices=5)
    tube("chain_lower", (-0.08, -0.069, 0.175), (-0.47, -0.069, 0.305), 0.003, metal, frame, vertices=5)
    tube("derailleur_hanger", (-0.55, -0.07, 0.35), (-0.49, -0.07, 0.25), 0.008, carbon, frame)
    gear("derailleur_jockey", (-0.48, -0.07, 0.25), 0.025, 0.008, 10, metal, frame)

    tube("handlebar_stem", (-0.11, 0.0, -0.07), (0.0, 0.0, 0.0), 0.016, carbon, handlebar)
    tube("handlebar_top", (0.0, -0.20, 0.0), (0.0, 0.20, 0.0), 0.013, carbon, handlebar)
    for side in (-1.0, 1.0):
        label = "left" if side > 0 else "right"
        points = (
            (0.0, side * 0.20, 0.0),
            (0.06, side * 0.21, -0.02),
            (0.11, side * 0.21, -0.09),
            (0.10, side * 0.21, -0.16),
            (0.04, side * 0.21, -0.185),
            (-0.015, side * 0.21, -0.175),
        )
        for index in range(len(points) - 1):
            tube(
                f"handlebar_drop_{label}_{index + 1}",
                points[index],
                points[index + 1],
                0.012,
                carbon,
                handlebar,
            )
        box(f"handlebar_hood_{label}", (0.065, side * 0.21, -0.035), (0.065, 0.038, 0.045), rubber, handlebar, rotation=(0.0, -0.25, 0.0))
        tube(f"handlebar_lever_{label}", (0.085, side * 0.21, -0.045), (0.115, side * 0.21, -0.105), 0.005, metal, handlebar, vertices=6)

    saddle_outline = (
        (-0.13, -0.052),
        (-0.075, -0.068),
        (0.035, -0.037),
        (0.15, -0.018),
        (0.15, 0.018),
        (0.035, 0.037),
        (-0.075, 0.068),
        (-0.13, 0.052),
    )
    vertices = [(x, y, 0.045 - max(x, 0.0) * 0.12) for x, y in saddle_outline]
    vertices.extend((x * 0.92, y * 0.9, 0.005) for x, y in saddle_outline)
    count = len(saddle_outline)
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, following + count, index + count))
    custom_mesh("saddle_shell", vertices, faces, leather, saddle)
    for side in (-1.0, 1.0):
        tube(f"saddle_rail_{'left' if side > 0 else 'right'}", (-0.09, side * 0.033, 0.008), (0.055, side * 0.023, 0.018), 0.004, metal, saddle, vertices=6)

    tube("bottle_body", (-0.01, 0.0, 0.43), (-0.135, 0.0, 0.66), 0.035, bottle_mat, frame, vertices=12)
    tube("bottle_cap", (-0.142, 0.0, 0.674), (-0.15, 0.0, 0.692), 0.019, accent, frame, vertices=10)
    tube("bottle_cage_base", (-0.17, 0.0, 0.47), (-0.04, 0.0, 0.61), 0.005, metal, frame, vertices=6)
    return bike


def tier_mesh(name, radius: float, height: float, sides: int, phase: float, mat, parent, base_z: float):
    vertices = [(0.0, 0.0, base_z + height)]
    for index in range(sides):
        angle = 2.0 * math.pi * index / sides + phase
        variation = 1.0 + 0.09 * math.sin(index * 2.17 + phase * 3.0)
        vertices.append((math.cos(angle) * radius * variation, math.sin(angle) * radius * variation, base_z + 0.035 * math.sin(index * 1.73)))
    for index in range(sides):
        angle = 2.0 * math.pi * index / sides + phase
        vertices.append((math.cos(angle) * radius * 0.16, math.sin(angle) * radius * 0.16, base_z + height * 0.77))
    faces = [tuple(reversed(range(1, sides + 1)))]
    for index in range(sides):
        following = (index + 1) % sides
        faces.append((index + 1, following + 1, following + sides + 1, index + sides + 1))
        faces.append((index + sides + 1, following + sides + 1, 0))
    return custom_mesh(name, vertices, faces, mat, parent)


def build_pine():
    bark = material("pine_bark", "6B4B35", roughness=0.92)
    dark = material("pine_needles_dark", "174C3C", roughness=0.88)
    middle = material("pine_needles_mid", "21664A", roughness=0.86)
    light = material("pine_needles_light", "2F7D57", roughness=0.84)

    pine = empty("pine_tree")
    trunk = empty("trunk", parent=pine)
    canopy = empty("canopy", parent=pine)
    tube("trunk_main", (0.0, 0.0, 0.0), (0.0, 0.0, 3.15), 0.115, bark, trunk, vertices=8)
    tube("trunk_top", (0.0, 0.0, 2.75), (0.0, 0.0, 3.62), 0.045, bark, trunk, vertices=7)
    for index in range(7):
        angle = 2.0 * math.pi * index / 7.0
        tube(
            f"trunk_root_{index + 1:02d}",
            (0.0, 0.0, 0.10),
            (math.cos(angle) * 0.31, math.sin(angle) * 0.31, 0.015),
            0.033,
            bark,
            trunk,
            vertices=5,
        )

    layers = (
        ("canopy_lower", 1.12, 1.48, 0.48, 0.0, dark),
        ("canopy_middle_lower", 0.94, 1.36, 1.03, 0.17, middle),
        ("canopy_middle_upper", 0.73, 1.22, 1.57, 0.31, dark),
        ("canopy_upper", 0.51, 1.08, 2.08, 0.08, middle),
        ("canopy_crown", 0.31, 0.88, 2.58, 0.24, light),
    )
    for name, radius, height, base_z, phase, mat in layers:
        tier_mesh(name, radius, height, 12, phase, mat, canopy, base_z)
    return pine


def perturb_rock(obj, seed: int, strength: float):
    rng = random.Random(seed)
    for vertex in obj.data.vertices:
        direction = vertex.co.normalized()
        vertex.co += direction * rng.uniform(-strength, strength)
    obj.data.update()


def world_vertices(obj, depsgraph=None):
    evaluated = obj if depsgraph is None else obj.evaluated_get(depsgraph)
    return [evaluated.matrix_world @ vertex.co for vertex in evaluated.data.vertices]


def build_rocks():
    stone_dark = material("rock_dark", "59636A", roughness=0.96)
    stone_mid = material("rock_mid", "707A7D", roughness=0.94)
    stone_light = material("rock_light", "89918E", roughness=0.92)
    moss = material("rock_moss", "526647", roughness=0.98)

    cluster = empty("rock_cluster")
    rocks = (
        ("rock_01", (-0.34, 0.02, 0.31), (0.64, 0.48, 0.42), (0.08, -0.18, 0.12), stone_mid, 2, 11, 0.16),
        ("rock_02", (0.29, 0.10, 0.24), (0.49, 0.39, 0.34), (-0.12, 0.22, -0.08), stone_dark, 2, 23, 0.17),
        ("rock_03", (0.03, -0.29, 0.17), (0.40, 0.32, 0.25), (0.18, 0.05, 0.21), stone_light, 1, 37, 0.20),
        ("rock_04", (-0.13, 0.30, 0.13), (0.30, 0.25, 0.20), (-0.06, 0.31, -0.14), stone_mid, 1, 41, 0.18),
        ("rock_05", (0.38, -0.18, 0.09), (0.22, 0.19, 0.14), (0.13, -0.24, 0.07), stone_light, 1, 53, 0.18),
    )
    for name, location, scale, rotation, mat, subdivisions, seed, strength in rocks:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0)
        obj = bpy.context.object
        perturb_rock(obj, seed, strength)
        finish_mesh(obj, name, mat, cluster)
        obj.location = location
        obj.scale = scale
        obj.rotation_euler = rotation

    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0)
    moss_patch = bpy.context.object
    perturb_rock(moss_patch, 67, 0.12)
    finish_mesh(moss_patch, "rock_moss_patch", moss, cluster)
    moss_patch.location = (-0.27, -0.01, 0.60)
    moss_patch.scale = (0.30, 0.24, 0.045)
    moss_patch.rotation_euler = (0.10, -0.16, 0.20)

    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    minimum_z = min(
        vertex.z
        for obj in cluster.children
        if obj.type == "MESH"
        for vertex in world_vertices(obj, depsgraph)
    )
    for obj in cluster.children:
        obj.location.z -= minimum_z
    bpy.context.view_layer.update()
    grounded_z = min(vertex.z for obj in cluster.children for vertex in world_vertices(obj))
    if abs(grounded_z) > 0.000001:
        raise RuntimeError(f"rock source grounding failed: min Z {grounded_z}")
    return cluster


def triangle_count(objects) -> int:
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def material_names(objects) -> list[str]:
    return sorted({mat.name for obj in objects if obj.type == "MESH" for mat in obj.data.materials})


def world_bounds(obj):
    points = world_vertices(obj)
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return minimum, maximum


def distance_to_point(obj, point) -> float:
    target = Vector(point)
    return min((vertex - target).length for vertex in world_vertices(obj))


def verify_bike_contract(by_name):
    expected_parents = {
        "frame": "bike",
        "fork": "bike",
        "anchor_wheel_front": "bike",
        "wheel_front": "anchor_wheel_front",
        "anchor_wheel_rear": "bike",
        "wheel_rear": "anchor_wheel_rear",
        "anchor_crank": "bike",
        "crank": "anchor_crank",
        "pedal_l": "crank",
        "pedal_r": "crank",
        "anchor_saddle": "bike",
        "saddle": "anchor_saddle",
        "anchor_handlebar": "bike",
        "handlebar": "anchor_handlebar",
    }
    for child, parent in expected_parents.items():
        actual_parent = by_name[child].parent
        if actual_parent is None or actual_parent.name != parent:
            raise RuntimeError(f"bike.glb: {child} must be a child of {parent}")

    for anchor, expected in (
        ("anchor_wheel_front", (0.57, 0.0, 0.35)),
        ("anchor_wheel_rear", (-0.55, 0.0, 0.35)),
        ("anchor_crank", (-0.08, 0.0, 0.28)),
        ("anchor_saddle", (-0.255, 0.0, 0.91)),
        ("anchor_handlebar", (0.42, 0.0, 0.92)),
    ):
        actual = by_name[anchor].matrix_local.translation
        if (Vector(actual) - Vector(expected)).length > 0.0001:
            raise RuntimeError(f"bike.glb: {anchor} pivot mismatch: {tuple(actual)}")

    for child in ("wheel_front", "wheel_rear", "crank", "saddle", "handlebar"):
        if by_name[child].matrix_local.translation.length > 0.0001:
            raise RuntimeError(f"bike.glb: {child} origin must match its anchor")

    for label in ("front", "rear"):
        wheel = by_name[f"wheel_{label}"]
        tire = by_name[f"{label}_tire"]
        inverse = wheel.matrix_world.inverted()
        local = [inverse @ vertex for vertex in world_vertices(tire)]
        axial = max(abs(point.y) for point in local)
        radii = [math.hypot(point.x, point.z) for point in local]
        if axial > 0.0271 or min(radii) < 0.2959 or max(radii) > 0.3501:
            raise RuntimeError(
                f"bike.glb: {label} wheel plane/radius mismatch: "
                f"axial={axial}, radii={min(radii)}..{max(radii)}"
            )

    pedal_left = by_name["pedal_l"].matrix_local.translation
    pedal_right = by_name["pedal_r"].matrix_local.translation
    if (Vector(pedal_left) + Vector(pedal_right)).length > 0.0001:
        raise RuntimeError("bike.glb: pedals must be opposed by 180 degrees")
    for label, expected_axle_y in (("left", 0.075), ("right", -0.075)):
        minimum, maximum = world_bounds(by_name[f"pedal_{label}_axle"])
        actual_axle_y = minimum.y if label == "left" else maximum.y
        if abs(actual_axle_y - expected_axle_y) > 0.0001:
            raise RuntimeError(f"bike.glb: {label} pedal axle does not meet its crank arm")

    stem = by_name["handlebar_stem"]
    head_gap = distance_to_point(stem, (0.31, 0.0, 0.85))
    anchor_gap = distance_to_point(stem, (0.42, 0.0, 0.92))
    if head_gap > 0.0161 or anchor_gap > 0.0161:
        raise RuntimeError(f"bike.glb: cockpit detached; head gap={head_gap}, anchor gap={anchor_gap}")
    stem_minimum, stem_maximum = world_bounds(stem)
    print(
        "bike.glb contract: wheels centered in XY plane with 0.350 m outer radius; "
        "pedals opposed and axles meet crank arms; "
        f"stem world-Y {stem_minimum.z:.6f}..{stem_maximum.z:.6f}, "
        f"head gap={head_gap:.6f}, anchor gap={anchor_gap:.6f}"
    )


def verify_world_contract(filename: str, by_name):
    root_name = filename.removesuffix(".glb")
    if by_name[root_name].matrix_local.translation.length > 0.0001:
        raise RuntimeError(f"{filename}: root must sit at the origin")
    if root_name == "rock_cluster":
        minimum_y = min(
            vertex.z for obj in by_name.values() if obj.type == "MESH" for vertex in world_vertices(obj)
        )
        if abs(minimum_y) > 0.00001:
            raise RuntimeError(f"rock_cluster.glb: ground contact failed; min world-Y {minimum_y}")
        print(f"rock_cluster.glb contract: min world-Y {minimum_y:.6f}")


def verify_import(filename: str, expected_nodes: list[str], expected_materials: list[str], budget: int):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path = ASSETS_DIR / filename
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    objects = list(bpy.context.scene.objects)
    actual_nodes = sorted(obj.name for obj in objects)
    if actual_nodes != sorted(expected_nodes):
        missing = sorted(set(expected_nodes) - set(actual_nodes))
        extra = sorted(set(actual_nodes) - set(expected_nodes))
        raise RuntimeError(f"{filename}: node mismatch; missing={missing}, extra={extra}")
    actual_materials = material_names(objects)
    if actual_materials != sorted(expected_materials):
        raise RuntimeError(f"{filename}: material mismatch; expected={expected_materials}, actual={actual_materials}")
    triangles = triangle_count(objects)
    if triangles > budget:
        raise RuntimeError(f"{filename}: {triangles} triangles exceeds budget {budget}")
    if path.stat().st_size == 0:
        raise RuntimeError(f"{filename}: empty GLB")

    by_name = {obj.name: obj for obj in objects}
    root_name = filename.removesuffix(".glb")
    if root_name == "bike":
        verify_bike_contract(by_name)
    elif root_name in {"pine_tree", "rock_cluster"}:
        verify_world_contract(filename, by_name)

    return {
        "id": root_name,
        "file": filename,
        "license": LICENSE,
        "triangles": triangles,
        "triangleBudget": budget,
        "materials": actual_materials,
        "nodeNames": actual_nodes,
        "byteSize": path.stat().st_size,
    }


def manifest_lines(value, level: int = 0, prefix: str = ""):
    if isinstance(value, dict):
        if not value:
            return [prefix + "{}"]
        lines = [prefix + "{"]
        items = list(value.items())
        for index, (key, child) in enumerate(items):
            child_prefix = "  " * (level + 1) + json.dumps(key, ensure_ascii=False) + ": "
            child_lines = manifest_lines(child, level + 1, child_prefix)
            if index < len(items) - 1:
                child_lines[-1] += ","
            lines.extend(child_lines)
        lines.append("  " * level + "}")
        return lines
    if isinstance(value, list):
        compact = json.dumps(value, ensure_ascii=False)
        if len(prefix) + len(compact) <= 100:
            return [prefix + compact]
        lines = [prefix + "["]
        for index, child in enumerate(value):
            child_lines = manifest_lines(child, level + 1, "  " * (level + 1))
            if index < len(value) - 1:
                child_lines[-1] += ","
            lines.extend(child_lines)
        lines.append("  " * level + "]")
        return lines
    return [prefix + json.dumps(value, ensure_ascii=False)]


def main():
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEWS_DIR.mkdir(parents=True, exist_ok=True)
    records = []

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bike = build_bike()
    bike_nodes = sorted(obj.name for obj in descendants(bike))
    bike_materials = material_names(descendants(bike))
    export_glb(bike, "bike.glb")
    render_preview(bike, "bike.png", (2.55, -3.25, 1.55), (0.0, 0.0, 0.55), 8.0)
    records.append(("bike.glb", bike_nodes, bike_materials, BIKE_BUDGET))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    pine = build_pine()
    pine_nodes = sorted(obj.name for obj in descendants(pine))
    pine_materials = material_names(descendants(pine))
    export_glb(pine, "pine_tree.glb")
    render_preview(pine, "pine_tree.png", (4.4, -6.0, 3.4), (0.0, 0.0, 1.75), 12.0)
    records.append(("pine_tree.glb", pine_nodes, pine_materials, PINE_BUDGET))

    bpy.ops.wm.read_factory_settings(use_empty=True)
    rocks = build_rocks()
    rock_nodes = sorted(obj.name for obj in descendants(rocks))
    rock_materials = material_names(descendants(rocks))
    export_glb(rocks, "rock_cluster.glb")
    render_preview(rocks, "rock_cluster.png", (2.6, -3.5, 1.9), (0.0, 0.0, 0.42), 6.0)
    records.append(("rock_cluster.glb", rock_nodes, rock_materials, ROCK_BUDGET))

    manifest = {"schemaVersion": 1, "assets": []}
    for filename, nodes, materials, budget in records:
        record = verify_import(filename, nodes, materials, budget)
        manifest["assets"].append(record)
        print(
            f"verified {filename}: {record['triangles']} triangles, "
            f"{record['byteSize']} bytes, {len(record['materials'])} materials, "
            f"{len(record['nodeNames'])} nodes"
        )

    MANIFEST_PATH.write_text("\n".join(manifest_lines(manifest)) + "\n", encoding="utf-8")
    print(f"wrote {MANIFEST_PATH}")


if __name__ == "__main__":
    main()
