from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, List
import numpy as np

app = FastAPI(title="2D Truss FEM Solver API")

# Allow frontend to communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# REQUEST & RESPONSE MODELS
class Node(BaseModel):
    x: float
    y: float

class Element(BaseModel):
    i: int
    j: int

class Force(BaseModel):
    fx: float = 0.0
    fy: float = 0.0

class BoundaryCondition(BaseModel):
    fix_x: bool = False
    fix_y: bool = False

class AnalysisRequest(BaseModel):
    nodes: List[Node]
    elements: List[Element]
    E: float = 200e9        # Elastic modulus (Pa)
    A: float = 0.004        # Cross-section area (m²)
    forces: Dict[int, Force] = {}
    boundary_conditions: Dict[int, BoundaryCondition] = {}
    include_self_weight: bool = False
    gravity: float = 9.81
    density: float = 7850.0

class ElementResult(BaseModel):
    element_id: int
    node_i: int
    node_j: int
    force_kN: float
    type: str               # "Tension" or "Compression"

class NodeDisplacement(BaseModel):
    node_id: int
    ux_mm: float
    uy_mm: float

class SupportReaction(BaseModel):
    node_id: int
    rx_kN: float
    ry_kN: float

class AnalysisResponse(BaseModel):
    success: bool
    message: str = ""
    displacements: List[NodeDisplacement] = []
    element_results: List[ElementResult] = []
    reactions: List[SupportReaction] = []
    equilibrium_fx: float = 0.0
    equilibrium_fy: float = 0.0


# FEM SOLVER
def solve_truss_fem(nodes_arr, elements_list, E, A, forces_map, bc_map):
    num_nodes = len(nodes_arr)
    num_dof   = 2 * num_nodes
    K_global  = np.zeros((num_dof, num_dof))

    # Assembly global stiffness matrix
    for idx, (ni, nj) in enumerate(elements_list):
        x1, y1 = nodes_arr[ni]
        x2, y2 = nodes_arr[nj]
        L = np.hypot(x2 - x1, y2 - y1)
        if L < 1e-12:
            raise ValueError(f"Element {idx} has zero length.")
        c = (x2 - x1) / L
        s = (y2 - y1) / L
        k = (E * A / L) * np.array([
            [ c*c,  c*s, -c*c, -c*s],
            [ c*s,  s*s, -c*s, -s*s],
            [-c*c, -c*s,  c*c,  c*s],
            [-c*s, -s*s,  c*s,  s*s]
        ])
        dofs = [2*ni, 2*ni+1, 2*nj, 2*nj+1]
        for r in range(4):
            for cc in range(4):
                K_global[dofs[r], dofs[cc]] += k[r, cc]

    # Assembly global force vector
    F_global = np.zeros(num_dof)
    for node_id, fvec in forces_map.items():
        F_global[2*node_id]     += fvec[0]
        F_global[2*node_id + 1] += fvec[1]

    # Apply boundary conditions
    active = np.ones(num_dof, dtype=bool)
    for node_id, bc in bc_map.items():
        if bc[0]: active[2*node_id]     = False
        if bc[1]: active[2*node_id + 1] = False

    # Solve
    K_red = K_global[np.ix_(active, active)]
    F_red = F_global[active]
    cond  = np.linalg.cond(K_red)
    if cond > 1e12:
        raise ValueError(
            f"Stiffness matrix nearly singular (cond={cond:.1e}). "
            "Check boundary conditions — minimum 3 restrained DOFs required."
        )
    u_active = np.linalg.solve(K_red, F_red)
    u_global = np.zeros(num_dof)
    u_global[active] = u_active

    # Element axial forces
    elem_forces = []
    for ni, nj in elements_list:
        x1, y1 = nodes_arr[ni]
        x2, y2 = nodes_arr[nj]
        L = np.hypot(x2 - x1, y2 - y1)
        c = (x2 - x1) / L
        s = (y2 - y1) / L
        ue = u_global[[2*ni, 2*ni+1, 2*nj, 2*nj+1]]
        f  = (E * A / L) * np.dot([-c, -s, c, s], ue)
        elem_forces.append(float(f))

    # Support reactions (subtract external forces at support nodes)
    F_full    = K_global @ u_global
    reactions = {}
    for node_id, bc in bc_map.items():
        f_ext_x = forces_map.get(node_id, [0.0, 0.0])[0]
        f_ext_y = forces_map.get(node_id, [0.0, 0.0])[1]
        rx = (F_full[2*node_id]     - f_ext_x) if bc[0] else 0.0
        ry = (F_full[2*node_id + 1] - f_ext_y) if bc[1] else 0.0
        reactions[node_id] = [float(rx), float(ry)]

    return u_global, elem_forces, reactions


def compute_self_weight(nodes_arr, elements_list, A, rho, g):
    sw = {}
    for ni, nj in elements_list:
        x1, y1 = nodes_arr[ni]
        x2, y2 = nodes_arr[nj]
        L = np.hypot(x2 - x1, y2 - y1)
        W = rho * A * L * g
        for node_id in [ni, nj]:
            if node_id not in sw:
                sw[node_id] = [0.0, 0.0]
            sw[node_id][1] -= W / 2.0
    return sw


# ENDPOINTS
@app.get("/")
def root():
    return {"message": "2D Truss FEM Solver API is running."}


@app.post("/analyze", response_model=AnalysisResponse)
def analyze(req: AnalysisRequest):
    try:
        # Convert nodes to numpy array
        nodes_arr = np.array([[n.x, n.y] for n in req.nodes])
        elements_list = [(e.i, e.j) for e in req.elements]

        # Build forces map
        forces_map = {}
        for node_id, f in req.forces.items():
            forces_map[int(node_id)] = [f.fx, f.fy]

        # Add self-weight if requested
        if req.include_self_weight:
            sw = compute_self_weight(
                nodes_arr, elements_list, req.A, req.density, req.gravity
            )
            for node_id, fvec in sw.items():
                if node_id in forces_map:
                    forces_map[node_id][0] += fvec[0]
                    forces_map[node_id][1] += fvec[1]
                else:
                    forces_map[node_id] = fvec

        # Build boundary conditions map
        bc_map = {}
        for node_id, bc in req.boundary_conditions.items():
            bc_map[int(node_id)] = [bc.fix_x, bc.fix_y]

        # Run FEM solver
        u_global, elem_forces, reactions = solve_truss_fem(
            nodes_arr, elements_list, req.E, req.A, forces_map, bc_map
        )

        # Build response
        displacements = [
            NodeDisplacement(
                node_id=i,
                ux_mm=float(u_global[2*i] * 1e3),
                uy_mm=float(u_global[2*i+1] * 1e3)
            )
            for i in range(len(req.nodes))
        ]

        element_results = [
            ElementResult(
                element_id=idx,
                node_i=e.i,
                node_j=e.j,
                force_kN=round(abs(f) / 1e3, 4),
                type="Compression" if f < 0 else "Tension"
            )
            for idx, (e, f) in enumerate(zip(req.elements, elem_forces))
        ]

        reaction_results = [
            SupportReaction(
                node_id=node_id,
                rx_kN=round(rv[0] / 1e3, 4),
                ry_kN=round(rv[1] / 1e3, 4)
            )
            for node_id, rv in reactions.items()
        ]

        # Equilibrium check
        eq_fx = sum(rv[0] for rv in reactions.values()) / 1e3
        eq_fy = sum(rv[1] for rv in reactions.values()) / 1e3

        return AnalysisResponse(
            success=True,
            displacements=displacements,
            element_results=element_results,
            reactions=reaction_results,
            equilibrium_fx=round(eq_fx, 6),
            equilibrium_fy=round(eq_fy, 6)
        )

    except ValueError as e:
        return AnalysisResponse(success=False, message=str(e))
    except Exception as e:
        return AnalysisResponse(success=False, message=f"Unexpected error: {str(e)}")