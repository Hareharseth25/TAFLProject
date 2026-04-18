# TAFLProject
Interactive Context-Free Grammar simplifier with animated step-by-step visualizations. CFG Lab is a web-based tool for analyzing and simplifying Context-Free Grammars (CFGs). It implements the complete simplification pipeline and presents results through an interactive, step-by-step visualization interface.

The system combines formal language theory with dynamic graph-based visualization to make grammar transformations intuitive and traceable.

Features
1. One-click CFG simplification
2. Step-by-step transformation walkthrough
3. Animated dependency graph visualization
4. Grammar validation and error detection
5. Interactive UI with live input feedback

Simplification Pipeline
The tool performs the following transformations while preserving language equivalence:

1. Null Production Removal
    Identifies nullable non-terminals
    Eliminates ε-productions using combination generation
2. Useless Symbol Elimination
    Removes non-generating symbols
    Removes unreachable symbols
3. Unit Production Elimination
    Eliminates rules of the form A → B
    Uses transitive closure over unit pairs

Core Concepts
1. Fixed-point computation for nullable and generating sets
2. Breadth-first search for reachability
3. Closure computation for unit productions
4. Graph-based representation of grammar dependencies


