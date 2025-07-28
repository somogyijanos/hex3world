#!/usr/bin/env python3
"""
Generate very simple ASCII STL files for better compatibility
"""

import os
import math

def write_stl_ascii(filename, triangles):
    """Write STL file in ASCII format"""
    with open(filename, 'w') as f:
        f.write(f'solid {os.path.basename(filename)}\n')
        
        for triangle in triangles:
            # Calculate normal
            v1 = [triangle[1][i] - triangle[0][i] for i in range(3)]
            v2 = [triangle[2][i] - triangle[0][i] for i in range(3)]
            normal = [
                v1[1]*v2[2] - v1[2]*v2[1],
                v1[2]*v2[0] - v1[0]*v2[2],
                v1[0]*v2[1] - v1[1]*v2[0]
            ]
            # Normalize
            length = math.sqrt(sum(n*n for n in normal))
            if length > 0:
                normal = [n/length for n in normal]
            else:
                normal = [0, 0, 1]
            
            f.write(f'  facet normal {normal[0]:.6f} {normal[1]:.6f} {normal[2]:.6f}\n')
            f.write('    outer loop\n')
            for vertex in triangle:
                f.write(f'      vertex {vertex[0]:.6f} {vertex[1]:.6f} {vertex[2]:.6f}\n')
            f.write('    endloop\n')
            f.write('  endfacet\n')
        
        f.write(f'endsolid {os.path.basename(filename)}\n')

def create_hexagon_triangles(radius=1.0, height=0.05):
    """Create triangles for a simple hexagon"""
    triangles = []
    
    # Create hex vertices - pointy-top orientation with vertex 0 at top-right
    # This matches the geometry_config: parallel_edge_direction: "x+"
    hex_bottom = []
    hex_top = []
    for i in range(6):
        # Start from 30° (top-right) and go clockwise  
        # This makes edge 0 (between vertex 0 and 1) point in positive X direction
        angle = (math.pi / 6) - (i * math.pi / 3)  # 30°, -30°, -90°, -150°, 150°, 90°
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        hex_bottom.append([x, y, 0])
        hex_top.append([x, y, height])
    
    center_bottom = [0, 0, 0]
    center_top = [0, 0, height]
    
    # Bottom face (triangles from center)
    for i in range(6):
        next_i = (i + 1) % 6
        triangles.append([center_bottom, hex_bottom[next_i], hex_bottom[i]])
    
    # Top face (triangles from center)
    for i in range(6):
        next_i = (i + 1) % 6
        triangles.append([center_top, hex_top[i], hex_top[next_i]])
    
    # Side faces
    for i in range(6):
        next_i = (i + 1) % 6
        # Two triangles per side
        triangles.append([hex_bottom[i], hex_top[i], hex_bottom[next_i]])
        triangles.append([hex_bottom[next_i], hex_top[i], hex_top[next_i]])
    
    return triangles

def create_simple_tree_triangles():
    """Create triangles for a simple tree"""
    triangles = []
    
    # Trunk (simple box)
    trunk_width = 0.1
    trunk_height = 0.3
    
    # Trunk vertices
    trunk_verts = [
        [-trunk_width/2, -trunk_width/2, 0],
        [trunk_width/2, -trunk_width/2, 0],
        [trunk_width/2, trunk_width/2, 0],
        [-trunk_width/2, trunk_width/2, 0],
        [-trunk_width/2, -trunk_width/2, trunk_height],
        [trunk_width/2, -trunk_width/2, trunk_height],
        [trunk_width/2, trunk_width/2, trunk_height],
        [-trunk_width/2, trunk_width/2, trunk_height],
    ]
    
    # Trunk faces
    trunk_faces = [
        [0, 1, 2], [0, 2, 3],  # bottom
        [4, 6, 5], [4, 7, 6],  # top
        [0, 4, 1], [1, 4, 5],  # front
        [2, 6, 3], [3, 6, 7],  # back
        [0, 3, 4], [3, 7, 4],  # left
        [1, 5, 2], [2, 5, 6],  # right
    ]
    
    for face in trunk_faces:
        triangles.append([trunk_verts[face[0]], trunk_verts[face[1]], trunk_verts[face[2]]])
    
    # Simple leaves (tetrahedron on top)
    leaves_center = [0, 0, trunk_height + 0.2]
    leaves_radius = 0.3
    
    # 4 points around the center
    leaves_verts = [
        [leaves_radius, 0, trunk_height],
        [-leaves_radius/2, leaves_radius*0.866, trunk_height],
        [-leaves_radius/2, -leaves_radius*0.866, trunk_height],
        [0, 0, trunk_height + 0.4]
    ]
    
    # Tetrahedron faces
    leaves_faces = [
        [0, 1, 2],
        [0, 3, 1],
        [1, 3, 2],
        [2, 3, 0]
    ]
    
    for face in leaves_faces:
        triangles.append([leaves_verts[face[0]], leaves_verts[face[1]], leaves_verts[face[2]]])
    
    return triangles

def create_simple_rock_triangles():
    """Create triangles for a simple rock"""
    triangles = []
    
    # Simple pyramid
    base_verts = [
        [0.15, 0.1, 0],
        [-0.1, 0.12, 0],
        [-0.12, -0.08, 0],
        [0.1, -0.1, 0]
    ]
    top = [0.02, 0.01, 0.12]
    
    # Base
    triangles.append([base_verts[0], base_verts[2], base_verts[1]])
    triangles.append([base_verts[0], base_verts[3], base_verts[2]])
    
    # Sides
    for i in range(4):
        next_i = (i + 1) % 4
        triangles.append([base_verts[i], top, base_verts[next_i]])
    
    return triangles

def main():
    models_dir = "/Users/somogyijanos/Repos/tiny/hex3world/assets/models/"
    
    print("Generating simple ASCII STL models...")
    
    # Generate models
    models = [
        ("grass_hex.stl", lambda: create_hexagon_triangles(1.0, 0.05)),
        ("water_hex.stl", lambda: create_hexagon_triangles(1.0, 0.02)),
        ("sand_hex.stl", lambda: create_hexagon_triangles(1.0, 0.03)),
        ("shore_hex.stl", lambda: create_hexagon_triangles(1.0, 0.04)),
        ("road_hex.stl", lambda: create_hexagon_triangles(1.0, 0.05)),
        ("simple_tree.stl", create_simple_tree_triangles),
        ("small_rock.stl", create_simple_rock_triangles),
    ]
    
    for filename, create_func in models:
        print(f"Creating {filename}...")
        triangles = create_func()
        write_stl_ascii(models_dir + filename, triangles)
        print(f"  {len(triangles)} triangles")
    
    print("All simple STL models generated successfully!")

if __name__ == "__main__":
    main()