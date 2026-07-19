import bpy
import math
import os
from pathlib import Path
from mathutils import Vector


PROJECT_DIR = str(Path(__file__).resolve().parent)
RENDER_PATH = "//robot_head_render.png"
BLEND_PATH = os.path.join(PROJECT_DIR, "robot_head.blend")


# Centralized art-direction parameters. These are deliberately expressed in
# model-space units so later visual iterations remain controlled and legible.
P = {
    "body_width": 3.86,
    "body_height": 3.65,
    "body_depth": 2.40,
    "body_z": 0.06,
    "body_bevel": 0.56,
    "face_width": 3.12,
    "face_height": 2.62,
    "face_depth": 0.18,
    "face_x": 0.02,
    "face_z": 0.01,
    "face_y": -1.135,
    "display_y": -1.229,
    "eye_x": 0.585,
    "eye_center_x": -0.024,
    "eye_z": 0.180,
    "eye_width": 0.34,
    "eye_height": 0.62,
    "pod_x": 2.35,
    "pod_z": -0.10,
    "pod_width": 0.68,
    "pod_height": 1.51,
    "horn_x": 0.89,
    "horn_base_z": 1.28,
    "horn_tip_z": 2.02,
    "ortho_scale": 6.44,
    "camera_target_x": 0.0,
    "camera_target_z": 0.36,
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def srgb(hex_value):
    hex_value = hex_value.lstrip("#")
    vals = [int(hex_value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    # Hex references are display-referred sRGB; shader colors are linear.
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in vals)


def make_principled_material(
    name,
    color_hex,
    roughness=0.4,
    metallic=0.0,
    emission_hex=None,
    emission_strength=0.0,
):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    color = srgb(color_hex)
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.22
        bsdf.inputs["Coat Roughness"].default_value = max(0.08, roughness * 0.55)
    if emission_hex and "Emission Color" in bsdf.inputs:
        e = srgb(emission_hex)
        bsdf.inputs["Emission Color"].default_value = (*e, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def smooth_object(obj):
    for poly in obj.data.polygons:
        poly.use_smooth = True


def add_beveled_cube(name, location, dimensions, bevel, material, segments=8):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new(name="Soft bevel", type="BEVEL")
    modifier.width = bevel
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.harden_normals = True
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    smooth_object(obj)
    obj.data.materials.append(material)
    return obj


def add_rounded_rect_prism(
    name,
    width,
    height,
    depth,
    radius,
    location,
    material,
    corner_segments=10,
    edge_bevel=0.055,
):
    """Create a thin prism whose *planar* corner radius is independent of depth."""
    hx, hz = width / 2.0, height / 2.0
    radius = min(radius, hx - 1e-4, hz - 1e-4)
    centers = (
        (hx - radius, -hz + radius, -90.0, 0.0),
        (hx - radius, hz - radius, 0.0, 90.0),
        (-hx + radius, hz - radius, 90.0, 180.0),
        (-hx + radius, -hz + radius, 180.0, 270.0),
    )
    outline = []
    for cx, cz, a0, a1 in centers:
        for i in range(corner_segments):
            t = i / (corner_segments - 1)
            a = math.radians(a0 + (a1 - a0) * t)
            outline.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))

    vertices = []
    for y in (-depth / 2.0, depth / 2.0):
        vertices.extend((x, y, z) for x, z in outline)
    n = len(outline)
    faces = []
    # Viewed from the camera, the front outline is counter-clockwise and points -Y.
    faces.append(tuple(range(n)))
    faces.append(tuple(range(2 * n - 1, n - 1, -1)))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(material)

    if edge_bevel > 0:
        modifier = obj.modifiers.new(name="Edge rolloff", type="BEVEL")
        modifier.width = edge_bevel
        modifier.segments = 4
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    smooth_object(obj)
    return obj


def add_superellipse_prism(
    name,
    width,
    height,
    depth,
    exponent,
    location,
    material,
    segments=128,
    edge_bevel=0.06,
):
    """Create the rounded-square profile |x/a|^n + |z/b|^n = 1."""
    hx, hz = width / 2.0, height / 2.0
    outline = []
    power = 2.0 / exponent
    # Starts at screen-right and travels counter-clockwise as seen by the camera.
    for i in range(segments):
        a = 2.0 * math.pi * i / segments
        ca, sa = math.cos(a), math.sin(a)
        x = hx * math.copysign(abs(ca) ** power, ca)
        z = hz * math.copysign(abs(sa) ** power, sa)
        outline.append((x, z))

    vertices = []
    for y in (-depth / 2.0, depth / 2.0):
        vertices.extend((x, y, z) for x, z in outline)
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(material)
    if edge_bevel > 0:
        modifier = obj.modifiers.new(name="Convex display edge", type="BEVEL")
        modifier.width = edge_bevel
        modifier.segments = 5
        modifier.limit_method = "ANGLE"
        modifier.harden_normals = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    smooth_object(obj)
    return obj


def taper_body(obj):
    half_h = P["body_height"] / 2.0
    for vert in obj.data.vertices:
        zn = max(-1.0, min(1.0, vert.co.z / half_h))
        # The reference is widest through the cheeks and slightly narrower at
        # both crown and chin, with the crown tapering a little more strongly.
        factor = 1.0 - 0.067 * abs(zn) ** 1.55 - 0.017 * zn
        vert.co.x *= factor
    obj.data.update()


def signed_power(value, exponent):
    if abs(value) < 1e-12:
        return 0.0
    return math.copysign(abs(value) ** exponent, value)


def add_superellipsoid(
    name,
    location,
    dimensions,
    vertical_exponent,
    depth_exponent,
    material,
    latitude_segments=48,
    longitude_segments=96,
):
    """Inflated rounded box with an analytically controlled front silhouette.

    The projected X/Z contour has exponent 2 / vertical_exponent. This avoids
    the long planar crown and sides produced by an all-edge beveled cube.
    """
    a, b, c = (v / 2.0 for v in dimensions)
    vertices = [(0.0, 0.0, -c)]
    for lat_i in range(1, latitude_segments):
        eta = -math.pi / 2.0 + math.pi * lat_i / latitude_segments
        ce = signed_power(math.cos(eta), vertical_exponent)
        z = c * signed_power(math.sin(eta), vertical_exponent)
        for lon_i in range(longitude_segments):
            omega = 2.0 * math.pi * lon_i / longitude_segments
            x = a * ce * signed_power(math.cos(omega), depth_exponent)
            y = b * ce * signed_power(math.sin(omega), depth_exponent)
            vertices.append((x, y, z))
    top_index = len(vertices)
    vertices.append((0.0, 0.0, c))

    faces = []
    first_ring = 1
    for i in range(longitude_segments):
        j = (i + 1) % longitude_segments
        faces.append((0, first_ring + j, first_ring + i))
    ring_count = latitude_segments - 1
    for ring in range(ring_count - 1):
        start = 1 + ring * longitude_segments
        next_start = start + longitude_segments
        for i in range(longitude_segments):
            j = (i + 1) % longitude_segments
            faces.append((start + i, start + j, next_start + j, next_start + i))
    last_ring = 1 + (ring_count - 1) * longitude_segments
    for i in range(longitude_segments):
        j = (i + 1) % longitude_segments
        faces.append((last_ring + i, last_ring + j, top_index))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(material)
    smooth_object(obj)
    return obj


def sculpt_integrated_crown_ears(obj):
    """Pull two restrained cat-ear tips directly from the shell surface."""
    ear_centers = (-1.03, 1.03)
    half_width = 0.34
    for vert in obj.data.vertices:
        x, y, z = vert.co
        if z <= 1.10:
            continue
        # Smoothly suppress the deformation toward the front/back poles so the
        # ear is a rounded 3D peak, not a ridge extruded through the head.
        ear_depth_radius = P["body_depth"] * 0.475
        depth_weight = max(0.0, 1.0 - (abs(y) / ear_depth_radius) ** 2)
        vertical_t = max(0.0, min(1.0, (z - 1.10) / 0.62))
        vertical_weight = vertical_t * vertical_t * (3.0 - 2.0 * vertical_t)
        bump = 0.0
        for center in ear_centers:
            dx = abs(x - center)
            if dx < half_width:
                # Cosine falloff has a zero derivative at the tip, keeping the
                # low-resolution silhouette softly rounded rather than cusped.
                bump = max(bump, math.cos((math.pi / 2.0) * dx / half_width) ** 0.60)
        vert.co.z += 0.285 * bump * depth_weight * vertical_weight
    obj.data.update()


def add_horn(name, side, material):
    ring_count = 7
    radial_segments = 28
    profiles = (
        # (height fraction, x radius, y radius)
        (0.00, 0.42, 0.36),
        (0.18, 0.37, 0.34),
        (0.43, 0.29, 0.29),
        (0.67, 0.20, 0.22),
        (0.84, 0.125, 0.15),
        (0.95, 0.070, 0.085),
        (1.00, 0.035, 0.042),
    )
    assert len(profiles) == ring_count
    vertices = []
    for frac, rx, ry in profiles:
        z = P["horn_base_z"] + frac * (P["horn_tip_z"] - P["horn_base_z"])
        lean = side * 0.15 * (frac ** 1.25)
        cx = side * P["horn_x"] + lean
        for i in range(radial_segments):
            a = 2.0 * math.pi * i / radial_segments
            # The base sits just in front of the crown so it reads as one molded
            # form instead of a cone pasted behind the head.
            vertices.append((cx + rx * math.cos(a), ry * math.sin(a) - 0.38, z))
    faces = []
    for ring in range(ring_count - 1):
        for i in range(radial_segments):
            j = (i + 1) % radial_segments
            a = ring * radial_segments + i
            b = ring * radial_segments + j
            c = (ring + 1) * radial_segments + j
            d = (ring + 1) * radial_segments + i
            faces.append((a, b, c, d))
    faces.append(tuple(range(radial_segments - 1, -1, -1)))
    top_start = (ring_count - 1) * radial_segments
    faces.append(tuple(top_start + i for i in range(radial_segments)))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    smooth_object(obj)
    subdivision = obj.modifiers.new(name="Horn smoothing", type="SUBSURF")
    subdivision.levels = 2
    subdivision.render_levels = 2
    return obj


def add_uv_ellipsoid(name, location, scale, material, rotation=(0.0, 0.0, 0.0), segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth_object(obj)
    obj.data.materials.append(material)
    return obj


def add_display_ellipse(name, center_x, center_z, width, height, y, material, segments=64):
    """Create a flat emissive ellipse that reads as graphics inside the display."""
    vertices = [(center_x, y, center_z)]
    for i in range(segments):
        angle = 2.0 * math.pi * i / segments
        vertices.append(
            (
                center_x + (width / 2.0) * math.cos(angle),
                y,
                center_z + (height / 2.0) * math.sin(angle),
            )
        )
    faces = []
    for i in range(segments):
        # Increasing angle is counter-clockwise from the negative-Y camera,
        # so this winding gives the digital surface a front-facing normal.
        faces.append((0, 1 + i, 1 + ((i + 1) % segments)))

    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def add_smile(material):
    """Build the smile as a flat ribbon rather than a tube above the screen."""
    points = (
        (-0.505, -0.445),
        (0.010, -0.625),
        (0.545, -0.425),
    )

    def interpolate_z(x):
        total = 0.0
        for i, (xi, zi) in enumerate(points):
            basis = 1.0
            for j, (xj, _) in enumerate(points):
                if i != j:
                    basis *= (x - xj) / (xi - xj)
            total += zi * basis
        return total

    sample_count = 56
    half_width = 0.0205
    vertices = []
    samples = []
    for i in range(sample_count):
        t = i / (sample_count - 1)
        x = points[0][0] + (points[-1][0] - points[0][0]) * t
        z = interpolate_z(x)
        samples.append((x, z))

    for i, (x, z) in enumerate(samples):
        previous = samples[max(0, i - 1)]
        following = samples[min(sample_count - 1, i + 1)]
        tangent_x = following[0] - previous[0]
        tangent_z = following[1] - previous[1]
        tangent_length = math.hypot(tangent_x, tangent_z)
        normal_x = -tangent_z / tangent_length
        normal_z = tangent_x / tangent_length
        vertices.append(
            (x - normal_x * half_width, P["display_y"] - 0.002, z - normal_z * half_width)
        )
        vertices.append(
            (x + normal_x * half_width, P["display_y"] - 0.002, z + normal_z * half_width)
        )

    faces = []
    for i in range(sample_count - 1):
        lower = 2 * i
        next_lower = 2 * (i + 1)
        faces.append((lower, next_lower, next_lower + 1, lower + 1))

    mesh = bpy.data.meshes.new("SmileMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Smile", mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(material)
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_area_light(name, location, energy, size, color, target=(0.0, 0.0, 0.0)):
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    look_at(obj, target)
    return obj


def add_emissive_backdrop():
    mat = make_principled_material(
        "Exact #E8E8E8 backdrop",
        "000000",
        roughness=1.0,
        emission_hex="E8E8E8",
        emission_strength=1.0,
    )
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.0
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.0
    bpy.ops.mesh.primitive_plane_add(
        size=20.0,
        location=(0.0, 3.0, 0.0),
        rotation=(math.pi / 2.0, 0.0, 0.0),
    )
    backdrop = bpy.context.object
    backdrop.name = "Uniform studio backdrop"
    backdrop.data.materials.append(mat)
    return backdrop


def build_scene():
    clear_scene()

    shell_mat = make_principled_material("Warm white shell", "F3F4F3", roughness=0.31)
    face_mat = make_principled_material(
        "Graphite face",
        "1B1B1B",
        roughness=0.28,
    )
    face_bsdf = face_mat.node_tree.nodes.get("Principled BSDF")
    if "Specular IOR Level" in face_bsdf.inputs:
        face_bsdf.inputs["Specular IOR Level"].default_value = 0.015
    if "Coat Weight" in face_bsdf.inputs:
        face_bsdf.inputs["Coat Weight"].default_value = 0.08
        face_bsdf.inputs["Coat Roughness"].default_value = 0.12
    face_bsdf.inputs["Emission Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    face_nodes = face_mat.node_tree.nodes
    face_links = face_mat.node_tree.links
    face_layer = face_nodes.new("ShaderNodeLayerWeight")
    face_layer.name = "Display edge facing"
    face_edge_power = face_nodes.new("ShaderNodeMath")
    face_edge_power.operation = "POWER"
    face_edge_power.inputs[1].default_value = 0.7
    face_edge_gain = face_nodes.new("ShaderNodeMath")
    face_edge_gain.operation = "MULTIPLY"
    face_edge_gain.inputs[1].default_value = 0.040
    face_links.new(face_layer.outputs["Facing"], face_edge_power.inputs[0])
    face_links.new(face_edge_power.outputs[0], face_edge_gain.inputs[0])
    face_links.new(face_edge_gain.outputs[0], face_bsdf.inputs["Emission Strength"])
    eye_mat = make_principled_material(
        "Cyan eye light",
        "C4C9CB",
        roughness=0.30,
        emission_hex="EBEBEB",
        emission_strength=0.34,
    )
    halo_mat = make_principled_material(
        "Soft cyan eye halo",
        "24565A",
        roughness=0.36,
        emission_hex="62DDE5",
        emission_strength=0.10,
    )
    smile_mat = make_principled_material(
        "Smile light",
        "FFFFFF",
        roughness=0.28,
        emission_hex="FFFFFF",
        emission_strength=0.45,
    )
    smile_bsdf = smile_mat.node_tree.nodes.get("Principled BSDF")
    if "Specular IOR Level" in smile_bsdf.inputs:
        smile_bsdf.inputs["Specular IOR Level"].default_value = 0.0
    if "Coat Weight" in smile_bsdf.inputs:
        smile_bsdf.inputs["Coat Weight"].default_value = 0.0
    pod_mats = {}
    for side, label, gain in ((-1, "Left", 0.28), (1, "Right", 0.12)):
        pod_mat = make_principled_material(
            f"{label} glossy white pod",
            "F3F4F3",
            roughness=0.18,
            emission_hex="FFFFFF",
            emission_strength=0.0,
        )
        pod_bsdf = pod_mat.node_tree.nodes.get("Principled BSDF")
        if "Coat Weight" in pod_bsdf.inputs:
            pod_bsdf.inputs["Coat Weight"].default_value = 0.35
            pod_bsdf.inputs["Coat Roughness"].default_value = 0.10
        pod_nodes = pod_mat.node_tree.nodes
        pod_links = pod_mat.node_tree.links
        pod_layer = pod_nodes.new("ShaderNodeLayerWeight")
        pod_invert = pod_nodes.new("ShaderNodeMath")
        pod_invert.operation = "SUBTRACT"
        pod_invert.inputs[0].default_value = 1.0
        pod_power = pod_nodes.new("ShaderNodeMath")
        pod_power.operation = "POWER"
        pod_power.inputs[1].default_value = 2.0
        pod_gain = pod_nodes.new("ShaderNodeMath")
        pod_gain.operation = "MULTIPLY"
        pod_gain.inputs[1].default_value = gain
        pod_links.new(pod_layer.outputs["Facing"], pod_invert.inputs[1])
        pod_links.new(pod_invert.outputs[0], pod_power.inputs[0])
        pod_links.new(pod_power.outputs[0], pod_gain.inputs[0])
        pod_links.new(pod_gain.outputs[0], pod_bsdf.inputs["Emission Strength"])
        pod_mats[side] = pod_mat
    eye_bsdf = eye_mat.node_tree.nodes.get("Principled BSDF")
    if "Specular IOR Level" in eye_bsdf.inputs:
        eye_bsdf.inputs["Specular IOR Level"].default_value = 0.15
    if "Coat Weight" in eye_bsdf.inputs:
        eye_bsdf.inputs["Coat Weight"].default_value = 0.0
    halo_bsdf = halo_mat.node_tree.nodes.get("Principled BSDF")
    if "Specular IOR Level" in halo_bsdf.inputs:
        halo_bsdf.inputs["Specular IOR Level"].default_value = 0.015
    if "Coat Weight" in halo_bsdf.inputs:
        halo_bsdf.inputs["Coat Weight"].default_value = 0.0
    body = add_superellipsoid(
        "White head shell",
        (0.0, 0.0, P["body_z"]),
        (P["body_width"], P["body_depth"], P["body_height"]),
        0.70,
        0.62,
        shell_mat,
        latitude_segments=52,
        longitude_segments=104,
    )
    sculpt_integrated_crown_ears(body)

    add_superellipsoid(
        "Black face display",
        (P["face_x"], P["face_y"], P["face_z"]),
        (P["face_width"], P["face_depth"], P["face_height"]),
        2.0 / 3.25,
        0.34,
        face_mat,
        latitude_segments=48,
        longitude_segments=112,
    )

    # Pods are subtly mirrored in tilt: their lower ends splay away from the head.
    for side, label in ((-1, "Left"), (1, "Right")):
        angle = math.radians(-side * 17.0)
        add_uv_ellipsoid(
            f"{label} floating side pod",
            (side * P["pod_x"], -0.015, P["pod_z"]),
            (P["pod_width"] / 2.0, 0.35, P["pod_height"] / 2.0),
            pod_mats[side],
            rotation=(0.0, angle, 0.0),
        )

    for side, label in ((-1, "Left"), (1, "Right")):
        eye_center_x = P["eye_center_x"] + side * P["eye_x"]
        add_display_ellipse(
            f"{label} recessed cyan halo",
            eye_center_x,
            P["eye_z"],
            0.56,
            0.84,
            P["display_y"],
            halo_mat,
        )
        add_display_ellipse(
            f"{label} cyan eye",
            eye_center_x,
            P["eye_z"],
            P["eye_width"],
            P["eye_height"],
            P["display_y"] - 0.002,
            eye_mat,
        )
    add_smile(smile_mat)
    add_emissive_backdrop()

    # Large sources create the broad, low-contrast gradients visible in the reference.
    add_area_light(
        "Lateral right key",
        (7.0, -1.5, 2.5),
        183.0,
        3.0,
        (1.0, 1.0, 1.0),
        target=(0.0, 0.0, 0.15),
    )
    add_area_light(
        "Broad front fill",
        (0.0, -5.0, 1.5),
        68.0,
        6.0,
        (1.0, 1.0, 1.0),
        target=(0.0, 0.0, -0.1),
    )
    add_area_light(
        "Upper shaping light",
        (3.0, -2.5, 7.0),
        73.0,
        4.0,
        (1.0, 1.0, 1.0),
        target=(0.0, 0.0, 0.5),
    )

    camera_data = bpy.data.cameras.new("Orthographic portrait camera")
    camera = bpy.data.objects.new("Orthographic portrait camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (P["camera_target_x"], -11.5, P["camera_target_z"])
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = P["ortho_scale"]
    camera_data.lens = 52
    look_at(camera, (P["camera_target_x"], 0.0, P["camera_target_z"]))
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    # Blender 5 exposes the Eevee Next renderer under the shorter enum name.
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 332
    scene.render.resolution_y = 301
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.render.filepath = RENDER_PATH
    scene.render.image_settings.color_management = "FOLLOW_SCENE"

    world = bpy.data.worlds.new("Soft gray studio") if not bpy.data.worlds else bpy.data.worlds[0]
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    ambient = srgb("E8E8E8")
    background.inputs["Color"].default_value = (*ambient, 1.0)
    background.inputs["Strength"].default_value = 0.704

    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0

    # Transparent film is disabled; the world itself supplies the exact studio field.
    scene.render.use_file_extension = True
    scene.render.image_settings.color_mode = "RGB"

    # Organize semantic groups for easy hand-editing in Blender.
    body["design_role"] = "outer_shell"
    scene["reference_image"] = "//reference.png"

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    build_scene()
