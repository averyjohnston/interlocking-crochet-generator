import React from "react";
import Modal from "./Modal";

export default function AboutModal(props) {
	return (
		<Modal handleCloseClick={props.handleCloseClick}>
			<h1>About ICG</h1>
			<p>Interlocking Crochet Generator</p>
			<p>Patterns are written assuming you know the basics of interlocking crochet, also called mosaic crochet, interlocking filet crochet, and intermeshing crochet.</p>
			<p>
				The starting row for the foreground color uses a long chain method, instead of two separate meshes, for maximum flexibility for the bottom rows.
				If you like, you can start with two meshes instead, although the finished product might not look exactly the same as the grid you draw.
			</p>
			<p><strong>Please don't sell patterns created in this tool.</strong> You can sell the finished product though. Credit is highly appreciated!</p>
		</Modal>
	);
}
