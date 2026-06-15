import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches


# CONSTANTS
G_EARTH   = 9.81    # Earth gravity (m/s²)
RHO_STEEL = 7850.0  # Steel density (kg/m³)


# 1. INPUT HELPERS
def _ask(prompt, cast=str, validator=None, default=None):
    """Generic input helper: type-cast, validate, optional default."""
    while True:
        raw = input(prompt).strip()
        if raw == "" and default is not None:
            return default
        try:
            val = cast(raw)
        except (ValueError, TypeError):
            print(f"  [!] Invalid input — expected {cast.__name__}. Try again.")
            continue
        if validator and not validator(val):
            print("  [!] Value out of range. Try again.")
            continue
        return val

def _ask_yn(prompt, default=True):
    """Yes/No prompt. Returns bool."""
    hint = "[Y/n]" if default else "[y/N]"
    raw = input(f"{prompt} {hint}: ").strip().lower()
    if raw == "":
        return default
    return raw in ("y", "yes")


# 2. STEP-BY-STEP INPUT FUNCTIONS
def input_nodes():
    print("\n──────────────────────────────────────────")
    print("  STEP 1 — Node Coordinates (meters)")
    print("──────────────────────────────────────────")
    n = _ask("  How many nodes? ", int, lambda v: v >= 2)
    nodes = []
    for i in range(n):
        print(f"  Node N{i}:")
        x = _ask(f"    X = ", float)
        y = _ask(f"    Y = ", float)
        nodes.append([x, y])
    return np.array(nodes, dtype=float)

def input_elements(num_nodes):
    print("\n──────────────────────────────────────────")
    print("  STEP 2 — Element Connectivity")
    print(f"  (node index: 0 to {num_nodes - 1})")
    print("──────────────────────────────────────────")
    m = _ask("  How many elements? ", int, lambda v: v >= 1)
    elements = []
    k = 0
    while k < m:
        print(f"  Element Elm-{k}:")
        i = _ask(f"    Node i = ", int, lambda v: 0 <= v < num_nodes)
        j = _ask(f"    Node j = ", int, lambda v: 0 <= v < num_nodes)
        if i == j:
            print("  [!] Node i and j cannot be the same. Re-enter.")
            continue
        elements.append([i, j])
        k += 1
    return elements

def input_material():
    print("\n──────────────────────────────────────────")
    print("  STEP 3 — Material Properties")
    print("  (applied uniformly to all elements)")
    print("──────────────────────────────────────────")
    E_GPa = _ask("  Elastic modulus E (GPa) [default: 200]: ",
                 float, lambda v: v > 0, default=200.0)
    A_cm2 = _ask("  Cross-section area A (cm²) [default: 40]: ",
                 float, lambda v: v > 0, default=40.0)
    return E_GPa * 1e9, A_cm2 * 1e-4   # Pa, m²

def input_boundary_conditions(num_nodes):
    print("\n──────────────────────────────────────────")
    print("  STEP 4 — Boundary Conditions")
    print("  Specify which DOFs are restrained per node.")
    print("  (minimum 3 restrained DOFs for stable 2D truss)")
    print("──────────────────────────────────────────")
    bc = {}
    for i in range(num_nodes):
        fix_x = _ask_yn(f"  Node N{i} — restrain X?", default=False)
        fix_y = _ask_yn(f"  Node N{i} — restrain Y?", default=False)
        if fix_x or fix_y:
            bc[i] = [fix_x, fix_y]
    if not bc:
        print("  [!] Warning: no boundary conditions set — structure will be unstable!")
    return bc

def input_forces(num_nodes):
    print("\n──────────────────────────────────────────")
    print("  STEP 5 — External Applied Forces")
    print("  (enter 0 to skip, compression = negative Y)")
    print("──────────────────────────────────────────")
    forces = {}
    for i in range(num_nodes):
        fx = _ask(f"  Node N{i}  Fx (kN) [default: 0]: ", float, default=0.0)
        fy = _ask(f"  Node N{i}  Fy (kN) [default: 0]: ", float, default=0.0)
        if fx != 0.0 or fy != 0.0:
            forces[i] = [fx * 1e3, fy * 1e3]   # kN → N
    return forces

def input_self_weight_settings():
    print("\n──────────────────────────────────────────")
    print("  STEP 6 — Self-Weight")
    print("──────────────────────────────────────────")
    include = _ask_yn("  Include element self-weight?", default=True)
    if not include:
        return False, G_EARTH, RHO_STEEL
    g = _ask(
        f"  Gravitational acceleration (m/s²) [default: {G_EARTH} — earth]: ",
        float, lambda v: v > 0, default=G_EARTH
    )
    rho = _ask(
        f"  Material density ρ (kg/m³) [default: {RHO_STEEL} — structural steel]: ",
        float, lambda v: v > 0, default=RHO_STEEL
    )
    return True, g, rho

def print_input_summary(nodes, elements, properties, forces_total, boundary_conditions, forces_ext, sw_forces):
    """Echo entered data and ask user to confirm before solving."""
    SEP = "─" * 62
    print(f"\n{SEP}")
    print("  INPUT SUMMARY — please verify before solving")
    print(SEP)

    print(f"\n  Nodes ({len(nodes)} total):")
    for i, (x, y) in enumerate(nodes):
        print(f"    N{i}: ({x:.3f}, {y:.3f}) m")

    print(f"\n  Elements ({len(elements)} total):")
    for k, (i, j) in enumerate(elements):
        print(f"    Elm-{k}: N{i} → N{j}")

    E_GPa = properties[0]['E'] / 1e9
    A_cm2 = properties[0]['A'] * 1e4
    print(f"\n  Material: E = {E_GPa:.0f} GPa | A = {A_cm2:.2f} cm²")

    print("\n  Boundary conditions:")
    if boundary_conditions:
        for node, bc in boundary_conditions.items():
            x_str = "fixed" if bc[0] else "free"
            y_str = "fixed" if bc[1] else "free"
            print(f"    N{node}: X={x_str}, Y={y_str}")
    else:
        print("    (none)")

    all_force_nodes = sorted(set(forces_ext) | set(sw_forces))

    print(f"\n  Applied forces:")
    if not all_force_nodes:
        print("    (none)")
    else:
        print(f"  {'Node':<6} {'Operational (kN)':^24} {'Self-weight (kN)':^24} {'Total (kN)':^24}")
        print("  " + "─" * 80)
        for node in all_force_nodes:
            op = forces_ext.get(node, [0.0, 0.0])
            sw = sw_forces.get(node, [0.0, 0.0])
            tot = forces_total.get(node, [0.0, 0.0])
            print(f"  N{node:<5} "
                  f"Fx={op[0] / 1e3:>7.3f}  Fy={op[1] / 1e3:>7.3f}    "
                  f"Fx={sw[0] / 1e3:>7.3f}  Fy={sw[1] / 1e3:>7.3f}    "
                  f"Fx={tot[0] / 1e3:>7.3f}  Fy={tot[1] / 1e3:>7.3f}")

    print()
    return _ask_yn("  Proceed with analysis?", default=True)

def collect_all_inputs():
    """Run the full interactive input sequence and return solver-ready data."""
    SEP = "=" * 52
    print(f"\n{SEP}")
    print("  2D TRUSS FEM SOLVER")
    print(f"{SEP}")
    print("  Enter your structure data step by step.")
    print("  Press Enter to accept [default] values.\n")

    nodes          = input_nodes()
    num_nodes      = len(nodes)
    elements       = input_elements(num_nodes)
    E, A           = input_material()
    properties     = [{'E': E, 'A': A}] * len(elements)
    boundary_conds = input_boundary_conditions(num_nodes)
    forces_ext     = input_forces(num_nodes)
    use_sw, g, rho = input_self_weight_settings()

    # Combine external forces + self-weight
    forces_total = {k: list(v) for k, v in forces_ext.items()}
    sw_total = 0.0
    sw_forces = {}

    if use_sw:
        sw_forces, sw_total = compute_self_weight(
            nodes, elements, properties, rho=rho, g=g
        )
        print(f"\n  [INFO] Structural self-weight: "
              f"{sw_total:.3f} N ({sw_total/1e3:.5f} kN)")
        print("         Relatively small compared to operational loads, "
              "but included for completeness.")
        for node, fvec in sw_forces.items():
            if node in forces_total:
                forces_total[node][0] += fvec[0]
                forces_total[node][1] += fvec[1]
            else:
                forces_total[node] = list(fvec)

    return nodes, elements, properties, forces_total, boundary_conds, sw_total, g, forces_ext, sw_forces


# 3. FEM SOLVER ENGINE
def solve_truss_fem(nodes, elements, properties, forces, boundary_conditions):
    """
    Solve 2D truss using Direct Stiffness Method.

    Parameters
    ----------
    nodes               : np.ndarray (N, 2)  — node coordinates (m)
    elements            : list of [i, j]     — element connectivity
    properties          : list of dict {'E', 'A'}
    forces              : dict {node: [Fx, Fy]} — external forces (N)
    boundary_conditions : dict {node: [fix_x, fix_y]}  True = restrained

    Returns
    -------
    displacements  : np.ndarray (N, 2)  — nodal displacements (m)
    element_forces : list of float      — axial forces (N), + = tension
    reactions      : dict {node: [Rx, Ry]} — support reactions (N)
    """
    num_nodes = len(nodes)
    num_dof   = 2 * num_nodes

    K_global = np.zeros((num_dof, num_dof))

    # Step 1: Assemble global stiffness matrix
    for idx, element in enumerate(elements):
        i, j   = element
        x1, y1 = nodes[i]
        x2, y2 = nodes[j]

        L = np.hypot(x2 - x1, y2 - y1)
        if L < 1e-12:
            raise ValueError(
                f"Element {idx} has zero length — check coordinates "
                f"of nodes {i} and {j}."
            )

        c = (x2 - x1) / L
        s = (y2 - y1) / L
        E = properties[idx]['E']
        A = properties[idx]['A']

        # 4×4 local stiffness matrix
        k_local = (E * A / L) * np.array([
            [ c*c,  c*s, -c*c, -c*s],
            [ c*s,  s*s, -c*s, -s*s],
            [-c*c, -c*s,  c*c,  c*s],
            [-c*s, -s*s,  c*s,  s*s]
        ])

        dofs = [2*i, 2*i+1, 2*j, 2*j+1]
        for row in range(4):
            for col in range(4):
                K_global[dofs[row], dofs[col]] += k_local[row, col]

    # Step 2: Assemble global force vector
    F_global = np.zeros(num_dof)
    for node, force_vec in forces.items():
        F_global[2*node]     += force_vec[0]
        F_global[2*node + 1] += force_vec[1]

    # Step 3: Apply boundary conditions
    #   True  = DOF is restrained (removed from active system)
    #   False = DOF is free
    active_dofs = np.ones(num_dof, dtype=bool)
    for node, bc in boundary_conditions.items():
        if bc[0]: active_dofs[2*node]     = False
        if bc[1]: active_dofs[2*node + 1] = False

    # Step 4: Solve reduced system [K]{u} = {F}
    K_reduced = K_global[np.ix_(active_dofs, active_dofs)]
    F_reduced = F_global[active_dofs]

    cond_number = np.linalg.cond(K_reduced)
    if cond_number > 1e12:
        raise ValueError(
            f"Stiffness matrix is nearly singular (cond = {cond_number:.2e}).\n"
            "Possible causes: structural mechanism (unstable) or "
            "insufficient boundary conditions."
        )

    try:
        u_active = np.linalg.solve(K_reduced, F_reduced)
    except np.linalg.LinAlgError as exc:
        raise ValueError(
            "Stiffness matrix is singular — structure is unstable or underconstrained!"
        ) from exc

    u_global = np.zeros(num_dof)
    u_global[active_dofs] = u_active

    # Step 5: Calculate internal axial forces
    element_forces = []
    for idx, element in enumerate(elements):
        i, j   = element
        x1, y1 = nodes[i]
        x2, y2 = nodes[j]
        L = np.hypot(x2 - x1, y2 - y1)
        c = (x2 - x1) / L
        s = (y2 - y1) / L

        dofs   = [2*i, 2*i+1, 2*j, 2*j+1]
        u_elem = u_global[dofs]

        # F = (EA/L) · [-c, -s, c, s] · {u}
        force = (properties[idx]['E'] * properties[idx]['A'] / L) * \
                np.dot(np.array([-c, -s, c, s]), u_elem)
        element_forces.append(force)

    # Step 6: Calculate support reactions
    F_full = K_global @ u_global
    reactions = {}
    for node, bc in boundary_conditions.items():
        rx = F_full[2*node]     if bc[0] else 0.0
        ry = F_full[2*node + 1] if bc[1] else 0.0
        reactions[node] = np.array([rx, ry])

    return u_global.reshape(-1, 2), element_forces, reactions


# 4. ELEMENT SELF-WEIGHT
def compute_self_weight(nodes, elements, properties, rho=RHO_STEEL, g=G_EARTH):
    """
    Compute element self-weight under earth gravity.
    Weight is split equally between the two end nodes (vertically downward).

    Returns
    -------
    sw_forces    : dict {node: [Fx, Fy]} — self-weight contributions (N)
    total_weight : float — total structural weight in earth environment (N)
    """
    sw = {}
    total_weight = 0.0

    for idx, element in enumerate(elements):
        i, j   = element
        x1, y1 = nodes[i]
        x2, y2 = nodes[j]
        L   = np.hypot(x2 - x1, y2 - y1)
        A   = properties[idx]['A']
        W   = rho * A * L * g   # element weight (N)
        total_weight += W

        for node in [i, j]:
            if node not in sw:
                sw[node] = [0.0, 0.0]
            sw[node][1] -= W / 2.0   # negative → downward

    return sw, total_weight


# 5. PLOTTING & VISUALIZATION
def plot_truss(nodes, elements, forces, displacements, element_forces,
                     reactions=None, title_suffix=""):
    """
    Plot undeformed vs deformed truss with color-coded axial forces,
    adaptive force arrows, and auto-scaled deformation.
    """
    fig, ax = plt.subplots(figsize=(13, 7))

    max_f    = max(abs(f) for f in element_forces) if element_forces else 1.0
    max_disp = np.max(np.abs(displacements))

    # Auto-scale deformation magnitude: display at ~5% of structure span
    span  = max(np.ptp(nodes[:, 0]), np.ptp(nodes[:, 1]))
    scale = (span * 0.05) / max_disp if max_disp > 1e-15 else 1.0

    # Plot elements
    for idx, element in enumerate(elements):
        i, j = element
        x_orig = [nodes[i][0], nodes[j][0]]
        y_orig = [nodes[i][1], nodes[j][1]]

        x_def = [nodes[i][0] + displacements[i][0]*scale,
                 nodes[j][0] + displacements[j][0]*scale]
        y_def = [nodes[i][1] + displacements[i][1]*scale,
                 nodes[j][1] + displacements[j][1]*scale]

        # Color: red = Compression, blue = Tension
        color     = 'red' if element_forces[idx] < 0 else 'blue'
        linewidth = 1.5 + 3.5 * (abs(element_forces[idx]) / max_f)

        ax.plot(x_orig, y_orig, 'k--', alpha=0.25, linewidth=1.0, zorder=1)
        ax.plot(x_def,  y_def,  color=color, linewidth=linewidth, alpha=0.85, zorder=2)

        # Axial force label at element midpoint
        xm = (x_def[0] + x_def[1]) / 2
        ym = (y_def[0] + y_def[1]) / 2
        ax.text(xm, ym, f"{abs(element_forces[idx])/1e3:.1f}kN",
                fontsize=7, ha='center', va='bottom', color=color,
                bbox=dict(boxstyle='round,pad=0.1', fc='white', alpha=0.6, ec='none'))

    # Plot nodes
    for i, node in enumerate(nodes):
        ax.plot(node[0], node[1], 'go', ms=7, zorder=5, markeredgecolor='darkgreen')
        ax.text(node[0] + 0.1, node[1] + 0.12, f"N{i}", fontsize=8,
                color='darkgreen', fontweight='bold')

    # External load arrows — adaptive scaling
    if forces:
        max_fmag  = max(np.hypot(f[0], f[1]) for f in forces.values())
        arrow_len = span * 0.12   # arrow length = 12% of structure span
        arr_scale = arrow_len / max_fmag if max_fmag > 0 else 1.0

        for node, fvec in forces.items():
            fx, fy = fvec
            mag    = np.hypot(fx, fy)
            if mag < 1e-6:
                continue
            dx = fx * arr_scale
            dy = fy * arr_scale
            ax.annotate(
                "", xy=(nodes[node][0] + dx, nodes[node][1] + dy),
                xytext=(nodes[node][0], nodes[node][1]),
                arrowprops=dict(arrowstyle="-|>", color='darkorange',
                                lw=2.0, mutation_scale=15)
            )
            ax.text(nodes[node][0] + dx*1.05,
                    nodes[node][1] + dy*1.05,
                    f"{mag/1e3:.1f}kN",
                    fontsize=7.5, color='darkorange',
                    ha='center', va='center')

    # Support markers & reaction forces
    if reactions:
        for node, rv in reactions.items():
            rx, ry = rv
            if abs(rx) > 1.0:
                ax.annotate("", xy=(nodes[node][0] - span*0.08, nodes[node][1]),
                            xytext=(nodes[node][0], nodes[node][1]),
                            arrowprops=dict(arrowstyle="-|>", color='purple',
                                            lw=1.5, mutation_scale=12))
                ax.text(nodes[node][0] - span*0.09, nodes[node][1],
                        f"Rx={rx/1e3:.1f}kN", fontsize=7, color='purple', ha='right')
            if abs(ry) > 1.0:
                ax.annotate("", xy=(nodes[node][0], nodes[node][1] - span*0.08),
                            xytext=(nodes[node][0], nodes[node][1]),
                            arrowprops=dict(arrowstyle="-|>", color='purple',
                                            lw=1.5, mutation_scale=12))
                ax.text(nodes[node][0], nodes[node][1] - span*0.09,
                        f"Ry={ry/1e3:.1f}kN", fontsize=7, color='purple', ha='center')

    # Legend & decorations
    patch_tension     = mpatches.Patch(color='blue',       label='Tension')
    patch_compression = mpatches.Patch(color='red',        label='Compression')
    patch_orig        = mpatches.Patch(color='black',      label='Undeformed structure (dashed)',
                                       alpha=0.3, linestyle='--')
    patch_force       = mpatches.Patch(color='darkorange', label='External force')
    patch_reaction    = mpatches.Patch(color='purple',     label='Support reaction')
    ax.legend(handles=[patch_tension, patch_compression, patch_orig,
                        patch_force, patch_reaction],
              loc='upper right', fontsize=8)

    ax.set_title(
        f"2D Truss FEM Analysis{title_suffix}\n"
        f"(Blue: Tension | Red: Compression | Deformation magnified {scale:.0f}×)",
        fontsize=11, fontweight='bold'
    )
    ax.set_xlabel("X-axis (Meter)")
    ax.set_ylabel("Y-axis (Meter)")
    ax.grid(True, linestyle=':', alpha=0.5)
    ax.set_aspect('equal')
    plt.tight_layout()

    out_path = 'truss_output.png'
    plt.savefig(out_path, dpi=300, bbox_inches='tight')
    print(f"\n[SUCCESS] Visualization saved as '{out_path}'")
    plt.show()


# 6. PRINT SUMMARY REPORT TO CONSOLE
def print_report(nodes, elements, displacements, element_forces, reactions,
                 self_weight_total=0.0, g_used=G_EARTH):
    """Print structured FEM results to console."""
    SEP = "=" * 52
    print(f"\n{SEP}")
    print("  2D TRUSS FEM ANALYSIS RESULT")
    print(SEP)

    print("\n[ NODE DISPLACEMENT ]")
    print(f"  {'Node':<8} {'Ux (mm)':>12} {'Uy (mm)':>12}")
    print("  " + "-"*36)
    for i, d in enumerate(displacements):
        print(f"  N{i:<7} {d[0]*1e3:>12.4f} {d[1]*1e3:>12.4f}")

    print("\n[ AXIAL FORCES ]")
    print(f"  {'Element':<10} {'Nodes':<12} {'Force (kN)':>12} {'Type':>16}")
    print("  " + "-"*54)
    for idx, f in enumerate(element_forces):
        ftype = "⬇ Compression" if f < 0 else "⬆ Tension"
        print(f"  Elm-{idx:<6} {str(elements[idx]):<12} {abs(f)/1e3:>12.2f} {ftype:>16}")

    print("\n[ SUPPORT REACTIONS ]")
    print(f"  {'Node':<8} {'Rx (kN)':>12} {'Ry (kN)':>12}")
    print("  " + "-"*36)
    for node, rv in reactions.items():
        print(f"  N{node:<7} {rv[0]/1e3:>12.2f} {rv[1]/1e3:>12.2f}")

    # Global equilibrium verification (ΣF = 0)
    total_rx = sum(rv[0] for rv in reactions.values())
    total_ry = sum(rv[1] for rv in reactions.values())
    print("\n[ EQUILIBRIUM VERIFICATION ]")
    print(f"  ΣFx reaction = {total_rx/1e3:.4f} kN  (should be ≈ 0)")
    print(f"  ΣFy reaction = {total_ry/1e3:.4f} kN  (should be ≈ 0)")

    if self_weight_total > 0:
        print(f"\n[ SELF-WEIGHT ]")
        print(f"  Total weight (g = {g_used} m/s²) = {self_weight_total:.2f} N"
              f"  ≈  {self_weight_total/1e3:.4f} kN")

    print(f"\n{SEP}\n")


# 7. MAIN EXECUTION
if __name__ == "__main__":
    while True:
        try:
            # Collect all inputs interactively
            (nodes, elements, properties,
             forces_total, boundary_conditions,
             sw_total, g_used, forces_ext, sw_forces) = collect_all_inputs()

            # Echo summary and confirm before solving
            if not print_input_summary(nodes, elements, properties,
                                       forces_total, boundary_conditions,
                                       forces_ext, sw_forces):
                print("\n  Restarting input...\n")
                continue

            # Run FEM solver
            print("\n  Running FEM analysis...")
            displacements, element_forces, reactions = solve_truss_fem(
                nodes, elements, properties, forces_total, boundary_conditions
            )

            # Print results
            print_report(nodes, elements, displacements, element_forces, reactions,
                         self_weight_total=sw_total, g_used=g_used)

            # Generate plot
            plot_truss(
                nodes, elements, forces_total, displacements, element_forces,
                reactions=reactions,
                title_suffix=f" | g = {g_used} m/s²"
            )

        except ValueError as e:
            print(f"\n  [ERROR] {e}\n")

        # Ask whether to run another analysis
        again = _ask_yn("\nRun another analysis?", default=False)
        if not again:
            print("\n  Exiting. Goodbye!\n")
            break